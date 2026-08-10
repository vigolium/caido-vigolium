import type { SDK } from "caido:plugin";
import type { Request, Response } from "caido:utils";
import { errorMessage } from "shared";
import type { LogService } from "../logging";
import type { RequestCounters } from "../counters";
import type { SettingsStore } from "../settings";
import { toBase64 } from "../util/bytes";
import type { VigoliumApiClient } from "../vigolium/client";
import { evaluate, type FilterTarget } from "./filter";

/**
 * Proxy Mode: forwards proxied exchanges to Vigolium ingestion as they happen.
 *
 * Runs off Caido's `onInterceptResponse`, which is asynchronous and cannot
 * modify traffic - the same read-only posture the Burp `ProxyController` had.
 * Forwarding is off unless explicitly enabled, and every exchange passes the
 * scope gate and the filter rules first.
 */
export class ProxyForwarder {
  #api: VigoliumApiClient;
  #log: LogService;
  #settings: SettingsStore;
  #counters: RequestCounters;

  constructor(
    api: VigoliumApiClient,
    log: LogService,
    settings: SettingsStore,
    counters: RequestCounters,
  ) {
    this.#api = api;
    this.#log = log;
    this.#settings = settings;
    this.#counters = counters;
  }

  async handle(sdk: SDK, request: Request, response: Response): Promise<void> {
    const settings = this.#settings.get();
    if (!settings.proxyEnabled) return;

    try {
      const inScope = sdk.requests.inScope(request);
      if (settings.proxyInScopeOnly && !inScope) return;

      if (!this.#api.isConfigured()) {
        this.#log.error("[Proxy] Skipped: Vigolium server URL is not configured");
        return;
      }

      if (!evaluate(settings.proxyFilterRules, buildTarget(request, response, inScope))) return;

      // Bytes are read up front so the send never depends on Caido's objects
      // still being live.
      const url = request.getUrl();
      const requestBase64 = toBase64(request.getRaw().toBytes());
      const responseBase64 = toBase64(response.getRaw().toBytes());

      this.#counters.incrementPending();
      try {
        await this.#api.ingest({
          input_mode: "burp_base64",
          url,
          http_request_base64: requestBase64,
          http_response_base64: responseBase64,
        });
        this.#counters.markSent();
        this.#log.info("[Proxy] Sent 1 request");
      } catch (e) {
        this.#counters.markFailed();
        this.#log.error(`[Proxy] Request failed: ${errorMessage(e)}`);
      }
    } catch (e) {
      this.#log.error(`[Proxy] Handler error: ${errorMessage(e)}`);
    }
  }
}

/**
 * Describes one exchange for the filter engine.
 *
 * This runs on every intercepted response, but the default rules only read the
 * path and the method - so the fields that cost real work (materialising the
 * body, reading headers) are getters and stay uncomputed unless a rule actually
 * asks for them. `inScope` is passed in because the caller has already had to
 * decide it.
 */
export function buildTarget(
  request: Request,
  response: Response | undefined,
  inScope: boolean,
): FilterTarget {
  return {
    method: request.getMethod(),
    url: request.getUrl(),
    path: request.getPath(),
    query: request.getQuery() ?? "",
    host: request.getHost(),
    get hasBody() {
      return (request.getBody()?.toRaw().length ?? 0) > 0;
    },
    get hasCookies() {
      // getHeader is case-insensitive, so one lookup covers every spelling.
      return (request.getHeader("Cookie") ?? []).length > 0;
    },
    statusCode: response?.getCode(),
    get contentType() {
      return response?.getHeader("Content-Type")?.[0];
    },
    inScope,
  };
}
