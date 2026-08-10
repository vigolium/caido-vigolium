import { Buffer } from "buffer";
import { createHash } from "crypto";
import type { SDK } from "caido:plugin";
import type { Request, Response } from "caido:utils";
import {
  EVENT_SNAPSHOT_STATUS,
  errorMessage,
  type SnapshotStatus,
  type VigoliumSettings,
} from "shared";
import { publish } from "../events";
import type { LogService } from "../logging";
import type { SettingsStore } from "../settings";
import { toBase64, view } from "../util/bytes";
import { REQUEST_PAGE_SIZE } from "../util/limits";
import type { SnapshotRecord, VigoliumApiClient } from "../vigolium/client";
import { MAX_CHUNK_RAW_BYTES, planChunks } from "./chunking";

type Pending = {
  url: string;
  requestBytes: Uint8Array;
  responseBytes: Uint8Array;
  identityFingerprint: string;
  contentFingerprint: string;
  rawBytes: number;
};

/**
 * Sitemap snapshot upload.
 *
 * Caido's Sitemap is a tree view over the project's requests, so the snapshot
 * walks the request store directly rather than the tree - same contents, no
 * per-node round trips.
 *
 * Snapshots are incremental within a session and idempotent on the server: a
 * per-record fingerprint pair (identity from url+request, content from the
 * response) lets unchanged traffic be skipped without re-uploading it. The
 * cache is dropped whenever the destination server or API key changes, since
 * "already synchronised" is only true relative to one destination.
 */
export class SnapshotService {
  #sdk: SDK;
  #settings: SettingsStore;
  #api: VigoliumApiClient;
  #log: LogService;

  #fingerprints = new Map<string, string>();
  #destination: string | undefined;
  #inProgress = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  #status: SnapshotStatus = idleStatus();

  constructor(sdk: SDK, settings: SettingsStore, api: VigoliumApiClient, log: LogService) {
    this.#sdk = sdk;
    this.#settings = settings;
    this.#api = api;
    this.#log = log;
  }

  status(): SnapshotStatus {
    return { ...this.#status };
  }

  start(): void {
    this.reschedule();
  }

  reschedule(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    const settings = this.#settings.get();
    if (!settings.snapshotAutoEnabled) {
      this.#publish({
        ...this.#status,
        state: "DISABLED",
        message: "Automatic snapshots disabled",
        nextRunAt: null,
      });
      return;
    }
    // The interval is already clamped to 1-1440 minutes by the settings store.
    this.#timer = setInterval(
      () => void this.snapshotNow("Auto"),
      settings.snapshotIntervalMinutes * 60_000,
    );
    void this.snapshotNow("Auto");
  }

  async snapshotNow(source: string): Promise<SnapshotStatus> {
    if (this.#inProgress) {
      this.#log.warn("[Sitemap Snapshot] Skipped: another snapshot is running");
      return this.status();
    }
    this.#inProgress = true;
    this.#publish({
      ...idleStatus(),
      state: "RUNNING",
      message: "Reading the Caido Sitemap…",
      completedAt: this.#status.completedAt,
    });

    try {
      if (!this.#api.isConfigured()) {
        throw new Error("Vigolium server URL is not configured");
      }
      await this.#resetCacheIfDestinationChanged();

      const settings = this.#settings.get();
      const { pending, discovered, oversized } = await this.#collect(settings.snapshotInScopeOnly);

      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      let failed = oversized;
      let uploaded = 0;

      const snapshotId = randomId();
      const capturedAt = new Date().toISOString();
      const chunks = planChunks(pending);

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const included = chunks[chunkIndex]!;
        const records: SnapshotRecord[] = included.map(toSnapshotRecord);

        const response = await this.#api.snapshotSitemap({
          snapshot_id: snapshotId,
          chunk_index: chunkIndex,
          final_chunk: chunkIndex === chunks.length - 1,
          captured_at: capturedAt,
          records,
        });

        uploaded += records.length;
        inserted += response.inserted;
        updated += response.updated;
        unchanged += response.unchanged;
        failed += response.skipped;

        // Only remember fingerprints for a chunk the server fully accepted;
        // otherwise a skipped record would never be retried.
        if (response.skipped === 0) {
          for (const record of included) {
            this.#fingerprints.set(record.identityFingerprint, record.contentFingerprint);
          }
        }
      }

      const status: SnapshotStatus = {
        ...idleStatus(),
        state: "SUCCESS",
        message:
          pending.length === 0 && oversized === 0
            ? "Sitemap already synchronized"
            : "Sitemap snapshot completed",
        discovered,
        uploaded,
        inserted,
        updated,
        unchanged,
        failed,
        completedAt: new Date().toISOString(),
        nextRunAt: nextRunAt(this.#settings.get()),
      };
      this.#publish(status);
      this.#log.info(
        `[Sitemap Snapshot:${source}] discovered=${discovered} uploaded=${uploaded} ` +
          `inserted=${inserted} updated=${updated} unchanged=${unchanged} failed=${failed}`,
      );
      return status;
    } catch (e) {
      const detail = errorMessage(e);
      const status: SnapshotStatus = {
        ...idleStatus(),
        state: "FAILED",
        message: `Snapshot failed: ${detail}`,
        failed: 1,
        completedAt: new Date().toISOString(),
        nextRunAt: nextRunAt(this.#settings.get()),
      };
      this.#publish(status);
      this.#log.error(`[Sitemap Snapshot:${source}] ${detail}`);
      return status;
    } finally {
      this.#inProgress = false;
    }
  }

  async #collect(inScopeOnly: boolean): Promise<{
    pending: Pending[];
    discovered: number;
    oversized: number;
  }> {
    const pending: Pending[] = [];
    let discovered = 0;
    let oversized = 0;
    let cursor: string | undefined;

    for (;;) {
      let query = this.#sdk.requests
        .query()
        .first(REQUEST_PAGE_SIZE)
        .ascending("req", "created_at");
      if (cursor) query = query.after(cursor);
      const page = await query.execute();
      if (page.items.length === 0) break;

      for (const item of page.items) {
        if (inScopeOnly && !this.#sdk.requests.inScope(item.request)) continue;
        discovered++;
        const record = toPending(item.request, item.response);
        if (!record) {
          oversized++;
          this.#log.warn(`[Sitemap Snapshot] Skipped oversized record: ${item.request.getUrl()}`);
          continue;
        }
        if (this.#fingerprints.get(record.identityFingerprint) !== record.contentFingerprint) {
          pending.push(record);
        }
      }

      cursor = page.pageInfo.endCursor;
      if (!page.pageInfo.hasNextPage) break;
    }
    return { pending, discovered, oversized };
  }

  async #resetCacheIfDestinationChanged(): Promise<void> {
    const identity = await this.#api.destinationIdentity();
    if (this.#destination === identity) return;
    this.#fingerprints.clear();
    this.#destination = identity;
  }

  #publish(status: SnapshotStatus): void {
    this.#status = status;
    publish(this.#sdk, EVENT_SNAPSHOT_STATUS, status);
  }
}

/** When the next automatic snapshot is due, or null when they are disabled. */
function nextRunAt(settings: VigoliumSettings): string | null {
  if (!settings.snapshotAutoEnabled) return null;
  return new Date(Date.now() + settings.snapshotIntervalMinutes * 60_000).toISOString();
}

/** Domain separator, so url+request cannot collide with a different split of the same bytes. */
const SEPARATOR = Buffer.from([0]);

function toPending(request: Request, response: Response | undefined): Pending | undefined {
  const requestBytes = request.getRaw().toBytes();
  const responseBytes = response ? response.getRaw().toBytes() : new Uint8Array(0);
  const rawBytes = requestBytes.length + responseBytes.length;
  if (rawBytes > MAX_CHUNK_RAW_BYTES) return undefined;

  const url = request.getUrl();
  const identityFingerprint = createHash("sha256")
    .update(Buffer.from(url, "utf-8"))
    .update(SEPARATOR)
    .update(view(requestBytes))
    .digest("hex");
  const contentFingerprint = createHash("sha256")
    .update(Buffer.from(identityFingerprint, "ascii"))
    .update(SEPARATOR)
    .update(view(responseBytes))
    .digest("hex");

  return { url, requestBytes, responseBytes, identityFingerprint, contentFingerprint, rawBytes };
}

function toSnapshotRecord(pending: Pending): SnapshotRecord {
  const record: SnapshotRecord = {
    url: pending.url,
    request_base64: toBase64(pending.requestBytes),
    identity_fingerprint: pending.identityFingerprint,
    content_fingerprint: pending.contentFingerprint,
  };
  if (pending.responseBytes.length > 0) {
    record.response_base64 = toBase64(pending.responseBytes);
  }
  return record;
}

function idleStatus(): SnapshotStatus {
  return {
    state: "IDLE",
    message: "Idle",
    discovered: 0,
    uploaded: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    completedAt: null,
    nextRunAt: null,
  };
}

function randomId(): string {
  const part = () => Math.random().toString(16).slice(2, 10);
  return `${part()}-${part()}-${part()}-${part()}`;
}
