import type { SDK } from "caido:plugin";
import {
  SERVER_NOT_CONFIGURED_MESSAGE,
  errorMessage,
  type DispatchKind,
  type RawDispatchInput,
} from "shared";
import type { LogService } from "../logging";
import type { RequestCounters } from "../counters";
import { blankToNull, type SettingsStore } from "../settings";
import { fromLatin1, toBase64 } from "../util/bytes";
import { MAX_RAW_PAYLOAD_BYTES, formatBytes } from "../util/limits";
import { VigoliumApiClient, VigoliumApiError } from "./client";

/** A request/response pair already reduced to raw bytes, safe to queue. */
export type DispatchItem = {
  url: string;
  requestBytes: Uint8Array;
  responseBytes: Uint8Array | null;
};

/**
 * How one dispatch workflow differs from the others: what it is called, whether
 * it is tallied, how it sends, and how it explains a failure. The loop that runs
 * them is shared.
 */
type Workflow = {
  label: string;
  /** Absent for agentic scans, which are not counted in request statistics. */
  counters: RequestCounters | undefined;
  /** Sends one item; anything returned is logged as per-item progress. */
  send: (item: DispatchItem) => Promise<string | undefined>;
  describeError: (e: unknown) => { level: "warn" | "error"; message: string };
};

/**
 * Concurrent `sdk.requests.get` lookups while resolving a selection.
 *
 * Deliberately bounded rather than an unbounded `Promise.all`: every resolved
 * item holds the full raw request and response, so fanning a large multi-select
 * out completely would trade latency for a memory spike.
 */
const LOOKUP_CONCURRENCY = 8;

/**
 * Resolves Caido request IDs into raw bytes.
 *
 * Done up front rather than inside the async send loop so a slow Vigolium
 * server never holds Caido request handles open.
 */
export async function collectItems(sdk: SDK, ids: string[]): Promise<DispatchItem[]> {
  const resolved = new Array<DispatchItem | undefined>(ids.length);
  let cursor = 0;

  const worker = async () => {
    for (let index = cursor++; index < ids.length; index = cursor++) {
      const found = await sdk.requests.get(ids[index]!);
      if (!found?.request) continue;
      resolved[index] = {
        url: found.request.getUrl(),
        requestBytes: found.request.getRaw().toBytes(),
        responseBytes: found.response ? found.response.getRaw().toBytes() : null,
      };
    }
  };

  const workers = Math.min(LOOKUP_CONCURRENCY, ids.length);
  await Promise.all(Array.from({ length: workers }, worker));
  // Selection order is preserved: workers write to their own index.
  return resolved.filter((item): item is DispatchItem => item !== undefined);
}

/**
 * The three dispatch workflows the context menu and hotkeys share: ingestion,
 * a native scan, and an agentic scan.
 *
 * Each runs sequentially in the background. A per-item failure is logged and
 * counted but never aborts the rest of the batch, so one unreachable target
 * does not discard a multi-select.
 */
export class DispatchService {
  #sdk: SDK;
  #api: VigoliumApiClient;
  #log: LogService;
  #settings: SettingsStore;
  #ingestCounters: RequestCounters;
  #scanCounters: RequestCounters;

  constructor(
    sdk: SDK,
    api: VigoliumApiClient,
    log: LogService,
    settings: SettingsStore,
    ingestCounters: RequestCounters,
    scanCounters: RequestCounters,
  ) {
    this.#sdk = sdk;
    this.#api = api;
    this.#log = log;
    this.#settings = settings;
    this.#ingestCounters = ingestCounters;
    this.#scanCounters = scanCounters;
  }

  /** Resolves Caido request IDs then dispatches - the row-selection entry point. */
  async dispatchIds(kind: DispatchKind, ids: string[], source: string): Promise<number> {
    if (!this.#configured(source)) return 0;
    return this.#dispatch(kind, await collectItems(this.#sdk, ids), source);
  }

  /**
   * Dispatches requests carried as raw text - the request/response editor entry
   * point, where the message may be an unsaved draft with no id.
   */
  async dispatchRaw(
    kind: DispatchKind,
    inputs: RawDispatchInput[],
    source: string,
  ): Promise<number> {
    if (!this.#configured(source)) return 0;
    const items: DispatchItem[] = inputs
      .filter((input) => input.request.length > 0)
      .map((input) => ({
        url: input.url,
        requestBytes: fromLatin1(input.request),
        responseBytes: input.response ? fromLatin1(input.response) : null,
      }));
    return this.#dispatch(kind, items, source);
  }

  #configured(source: string): boolean {
    if (this.#api.isConfigured()) return true;
    this.#log.error(`[${source}] Skipped: ${SERVER_NOT_CONFIGURED_MESSAGE}`);
    return false;
  }

  async #dispatch(kind: DispatchKind, items: DispatchItem[], source: string): Promise<number> {
    if (items.length === 0) {
      this.#log.warn(`[${source}] Nothing to send: no request bytes available`);
      return 0;
    }

    const workflow = this.#workflow(kind);
    const prefix = `[${source}:${workflow.label}]`;
    workflow.counters?.incrementPending(items.length);

    let sent = 0;
    for (const item of items) {
      if (this.#rejectIfOversize(item, prefix)) {
        workflow.counters?.markFailed();
        continue;
      }
      try {
        const progress = await workflow.send(item);
        workflow.counters?.markSent();
        sent++;
        if (progress) this.#log.info(`${prefix} ${progress}`);
      } catch (e) {
        workflow.counters?.markFailed();
        const failure = workflow.describeError(e);
        this.#log[failure.level](`${prefix} ${failure.message}`);
      }
    }

    this.#log.info(`${prefix} Sent ${sent}/${items.length} requests`);
    return sent;
  }

  #workflow(kind: DispatchKind): Workflow {
    switch (kind) {
      case "ingest":
        return {
          label: "Ingest",
          counters: this.#ingestCounters,
          send: async (item) => {
            await this.#api.ingest({
              input_mode: "burp_base64",
              url: item.url,
              http_request_base64: toBase64(item.requestBytes),
              http_response_base64: item.responseBytes ? toBase64(item.responseBytes) : null,
            });
            return undefined;
          },
          describeError: (e) => ({
            level: "error",
            message: `Failed to send request: ${errorMessage(e)}`,
          }),
        };

      case "scan": {
        // Read once per batch: the options apply to the whole dispatch, and a
        // mid-batch settings change should not split it across two scan configs.
        const settings = this.#settings.get();
        const modules = blankToNull(settings.customModules);
        const timeout = blankToNull(settings.scanTimeout);
        return {
          label: "Scan",
          counters: this.#scanCounters,
          send: async (item) => {
            const result = await this.#api.scan({
              url: item.url,
              http_request_base64: toBase64(item.requestBytes),
              http_response_base64: item.responseBytes ? toBase64(item.responseBytes) : null,
              modules,
              timeout,
            });
            return `${result.message} (scan_id: ${result.scanId})`;
          },
          describeError: (e) =>
            e instanceof VigoliumApiError && e.statusCode === 409
              ? { level: "warn", message: "A scan is already running" }
              : { level: "error", message: `Scan failed: ${errorMessage(e)}` },
        };
      }

      case "agentScan":
        return {
          label: "AgentScan",
          counters: undefined,
          send: async (item) =>
            `Started: ${await this.#api.agentScan({
              url: item.url,
              http_request_base64: toBase64(item.requestBytes),
              http_response_base64: item.responseBytes ? toBase64(item.responseBytes) : null,
              save_findings: true,
              mode: "balanced",
            })}`,
          describeError: (e) => ({
            level: "error",
            message: `Agent scan failed: ${errorMessage(e)}`,
          }),
        };
    }
  }

  /**
   * Reports an over-limit record instead of letting the server answer 413.
   *
   * The raw status code says nothing about which record was at fault or by how
   * much, which makes a partial batch failure very hard to act on.
   */
  #rejectIfOversize(item: DispatchItem, prefix: string): boolean {
    const rawBytes = item.requestBytes.length + (item.responseBytes?.length ?? 0);
    if (rawBytes <= MAX_RAW_PAYLOAD_BYTES) return false;
    this.#log.warn(
      `${prefix} Skipped ${item.url}: ${formatBytes(rawBytes)} exceeds the ` +
        `${formatBytes(MAX_RAW_PAYLOAD_BYTES)} the server accepts once base64-encoded`,
    );
    return true;
  }
}
