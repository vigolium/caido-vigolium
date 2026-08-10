import type { SDK } from "caido:plugin";
import {
  BRIDGE_IMPLEMENTATION,
  BRIDGE_SERVICE,
  MAX_REPEATER_TABS_PER_MINUTE,
  errorMessage,
} from "shared";
import type { LogService } from "../logging";
import { decodeBase64Strict, sha256Hex, toBase64, toLatin1 } from "../util/bytes";
import { pickInt, pickString, type Json } from "../util/json";
import { humanBytes } from "../util/limits";
import { requireAbsoluteHttpUrl } from "../util/rawhttp";
import {
  type SendOutcome,
  addToSitemap,
  injectRequest,
  loadCandidate,
  openInReplay,
  resolveCollectionId,
  scanCandidates,
  sendRaw,
} from "./caido";
import { headerValue, parseSearchCriteria } from "./search";
import type { RefStore } from "./refs";

// Caps ported verbatim from the Burp listener so both integrations reject the
// same payloads at the same thresholds.
export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_INSPECT_BYTES = 4 * 1024 * 1024;
/**
 * How much response body any reply may embed as base64.
 *
 * Shared by /send, /repeater and /organizer via `writeResponseFields`. It
 * happens to equal the /inspect read cap, but they answer different questions -
 * naming it separately keeps a change to one from silently moving the other.
 */
export const MAX_EMBEDDED_RESPONSE_BYTES = MAX_INSPECT_BYTES;
export const MAX_SITE_MAP_MESSAGE_BYTES = 8 * 1024 * 1024;
export const MAX_WRITE_BODY_BYTES = 24 * 1024 * 1024;
export const MAX_REPEATER_MESSAGE_BYTES = 1024 * 1024;
export const MAX_REPEATER_BODY_BYTES = 2 * 1024 * 1024;

const DEFAULT_SEND_TIMEOUT_MS = 30_000;
const MAX_SEND_TIMEOUT_MS = 120_000;

const SCOPE_BLOCKED_MESSAGE =
  "target is out of Caido scope; disable in-scope-only or add it to the project scope";

export class BridgeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BridgeError";
    this.status = status;
  }
}

export type RouteContext = {
  sdk: SDK;
  log: LogService;
  refs: RefStore;
  limiter: RepeaterRateLimiter;
  inScopeOnly: () => boolean;
  project: () => { id: string | null; name: string | null };
};

export type Endpoint = (ctx: RouteContext, args: Json) => Promise<Json> | Json;

export type BridgeRoute = {
  handler: Endpoint;
  /** Enforced by the listener before the body is read, so it must be declared here. */
  bodyLimit: number;
  /** Name this route answers to on /health. */
  capability: string;
};

// ------------------------------------------------------------------- /health

export function health(ctx: RouteContext): Json {
  const project = ctx.project();
  return {
    status: "ok",
    // Kept as the Burp listener's identifier so existing tooling that sniffs
    // this field keeps working; `implementation` says what actually answered.
    service: BRIDGE_SERVICE,
    implementation: BRIDGE_IMPLEMENTATION,
    read_only: false,
    loopback_only: true,
    in_scope_only: ctx.inScopeOnly(),
    authentication: "none",
    // Derived from the route table rather than listed separately: a capability
    // the listener does not actually serve is a lie the CLI acts on.
    capabilities: Object.values(BRIDGE_ROUTES).map((route) => route.capability),
    repeater_tabs_per_minute: MAX_REPEATER_TABS_PER_MINUTE,
    send_respects_in_scope_only: ctx.inScopeOnly(),
    // Caido scopes traffic per project, so which project is active changes what
    // /search returns. Reported here so CLI output stays explainable.
    project_id: project.id,
    project_name: project.name,
  };
}

// ------------------------------------------------------------------- /search

export async function search(ctx: RouteContext, args: Json): Promise<Json> {
  const criteria = parseSearchCriteria(args, ctx.inScopeOnly());
  const { candidates, truncated, scanned } = await scanCandidates(ctx.sdk, criteria);

  const total = candidates.length;
  const from = Math.min(criteria.offset, total);
  const to = criteria.limit === 0 ? total : Math.min(total, from + criteria.limit);

  const records = candidates.slice(from, to).map((candidate) => {
    const ref = ctx.refs.remember({
      requestId: candidate.request.getId(),
      url: candidate.request.getUrl(),
    });
    const record: Json = {
      ref,
      location: criteria.location,
      method: candidate.request.getMethod(),
      url: candidate.request.getUrl(),
      request_hash: sha256Hex(candidate.request.getRaw().toBytes()),
      status: candidate.response ? candidate.response.getCode() : 0,
      time: new Date(candidate.createdAt).toISOString(),
    };
    if (candidate.response) {
      const contentType = headerValue(candidate.response, "content-type");
      if (contentType) record.mime_type = contentType.split(";")[0]?.trim() ?? contentType;
    }
    return record;
  });

  if (truncated) {
    ctx.log.warn(
      `[Bridge] Search examined the first ${scanned} requests and stopped at the scan cap; ` +
        "totals are a floor. Narrow the filter for exact counts.",
    );
  }

  return {
    total,
    // Echoed per reply, not read once off /health, so Vigolium's read path pays
    // no extra round trip to learn that these records came from Caido.
    implementation: BRIDGE_IMPLEMENTATION,
    offset: from,
    returned: records.length,
    has_more: to < total,
    records,
    ...(truncated ? { truncated: true, scanned } : {}),
  };
}

// ------------------------------------------------------------------ /inspect

export async function inspect(ctx: RouteContext, args: Json): Promise<Json> {
  const ref = pickString(args, "ref");
  if (!ref) throw new BridgeError(400, "ref is required");
  const entry = ctx.refs.require(ref);
  const candidate = await loadCandidate(ctx.sdk, entry.requestId);

  const requested = pickInt(args, "max_bytes", 16384);
  const maxBytes = Math.max(1024, Math.min(requested, MAX_INSPECT_BYTES));

  const requestBytes = candidate.request.getRaw().toBytes();
  const responseBytes = candidate.response
    ? candidate.response.getRaw().toBytes()
    : new Uint8Array(0);

  const output: Json = {
    ref,
    // Repeated here rather than left to /search: an inspect can be the first
    // and only call of a session (Vigolium's single-record read has no
    // preceding search), and without it that record would fall back to `burp`.
    implementation: BRIDGE_IMPLEMENTATION,
    url: candidate.request.getUrl(),
    request_base64: toBase64(requestBytes.subarray(0, Math.min(requestBytes.length, maxBytes))),
    request_truncated: requestBytes.length > maxBytes,
  };
  // Small interactive reads keep the legacy text field; larger persistence
  // reads are base64-only so binary messages are not doubled in the response.
  if (maxBytes <= MAX_REQUEST_BYTES) output.request = toLatin1(requestBytes, maxBytes);

  if (candidate.response) {
    if (maxBytes <= MAX_REQUEST_BYTES) output.response = toLatin1(responseBytes, maxBytes);
    output.response_base64 = toBase64(
      responseBytes.subarray(0, Math.min(responseBytes.length, maxBytes)),
    );
    output.response_truncated = responseBytes.length > maxBytes;
  }
  return output;
}

// ------------------------------------------------------------------ /sitemap

export async function sitemap(ctx: RouteContext, args: Json): Promise<Json> {
  const resolved = await resolveRequest(ctx, args, MAX_SITE_MAP_MESSAGE_BYTES);
  const responseBytes = requireAtMost(
    decodeOptional(args, "http_response_base64"),
    MAX_SITE_MAP_MESSAGE_BYTES,
    "response",
  );
  const source = label(args, "source", 80, "vigolium");

  const requestId = await injectRequest(ctx.sdk, {
    url: resolved.url,
    requestBytes: resolved.requestBytes,
    responseBytes: responseBytes.length > 0 ? responseBytes : null,
    source,
  });
  await addToSitemap(ctx.sdk, requestId);
  ctx.log.info(`[Bridge] Added 1 item to the Sitemap from ${source}`);

  return {
    added: 1,
    url: resolved.url,
    request_hash: sha256Hex(resolved.requestBytes),
    message: "added 1 item to Caido Sitemap",
  };
}

// ----------------------------------------------------------------- /repeater

/** Sliding one-minute window so a runaway client cannot bury the UI in tabs. */
export class RepeaterRateLimiter {
  #timestamps: number[] = [];

  reserve(): void {
    const now = Date.now();
    const cutoff = now - 60_000;
    while (this.#timestamps.length > 0 && this.#timestamps[0]! < cutoff) {
      this.#timestamps.shift();
    }
    if (this.#timestamps.length >= MAX_REPEATER_TABS_PER_MINUTE) {
      throw new BridgeError(
        429,
        `Replay session limit reached (${MAX_REPEATER_TABS_PER_MINUTE} per minute); retry shortly`,
      );
    }
    this.#timestamps.push(now);
  }

  clear(): void {
    this.#timestamps = [];
  }
}

export async function repeater(ctx: RouteContext, args: Json): Promise<Json> {
  const resolved = await resolveRequest(ctx, args, MAX_REPEATER_MESSAGE_BYTES);
  const tabName = label(args, "tab_name", 64, "vigolium");
  const alsoSend = args.send === true;

  // Reserve before sending so a rate-limit rejection never puts traffic on the
  // wire, matching the Burp listener's ordering.
  ctx.limiter.reserve();
  const outcome = alsoSend ? await executeSend(ctx, resolved, args, false) : undefined;

  await openInReplay(
    ctx.sdk,
    {
      url: resolved.url,
      requestBytes: resolved.requestBytes,
      responseBytes: outcome?.responseBytes.length ? outcome.responseBytes : null,
      source: "vigolium-replay",
      roundtripTimeMs: outcome?.elapsedMs,
    },
    tabName,
  );
  ctx.log.info(`[Bridge] Opened Replay session "${tabName}"`);

  const output: Json = {
    sent: 1,
    url: resolved.url,
    tab_name: tabName,
    request_hash: sha256Hex(resolved.requestBytes),
  };
  if (outcome) {
    if (outcome.blocked) {
      // The session still opens; only the auto-send is skipped, so an
      // out-of-scope target does not lose its staged tab.
      output.executed = false;
      output.error = "target is out of Caido scope; not auto-sent";
    } else {
      output.executed = outcome.sent;
      writeResponseFields(output, outcome);
    }
  }
  output.message = "sent 1 request to Caido Replay";
  return output;
}

// --------------------------------------------------------------------- /send

export async function send(ctx: RouteContext, args: Json): Promise<Json> {
  const resolved = await resolveRequest(ctx, args, MAX_SITE_MAP_MESSAGE_BYTES);
  const mode = parseHttpMode(pickString(args, "http_mode"));
  const addToSiteMapRequested = args.add_to_sitemap === true;

  // Persisting through Caido's own send gives the Sitemap entry a real
  // roundtrip time, so only fall back to an explicit import when not saving.
  const outcome = await executeSend(ctx, resolved, args, addToSiteMapRequested);
  if (outcome.blocked) throw new BridgeError(403, SCOPE_BLOCKED_MESSAGE);

  const output: Json = {
    sent: outcome.sent ? 1 : 0,
    url: resolved.url,
    request_hash: sha256Hex(resolved.requestBytes),
    http_mode: mode,
  };
  writeResponseFields(output, outcome);

  if (addToSiteMapRequested && outcome.sent) {
    const requestId = await injectRequest(ctx.sdk, {
      url: resolved.url,
      requestBytes: resolved.requestBytes,
      responseBytes: outcome.responseBytes.length > 0 ? outcome.responseBytes : null,
      source: label(args, "source", 80, "vigolium-send"),
      roundtripTimeMs: outcome.elapsedMs,
    });
    await addToSitemap(ctx.sdk, requestId);
    output.added_to_sitemap = true;
  } else {
    output.added_to_sitemap = false;
  }

  ctx.log.info(
    outcome.sent
      ? `[Bridge] Sent 1 request via Caido to ${resolved.url} (HTTP ${outcome.statusCode})`
      : `[Bridge] Send via Caido to ${resolved.url} failed: ${outcome.error ?? "unknown"}`,
  );
  return output;
}

// ---------------------------------------------------------------- /organizer

const HIGHLIGHT_COLORS = new Set([
  "none",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "pink",
  "magenta",
  "gray",
]);

/**
 * Caido has no Organizer. Its Replay *collections* fill the same role better:
 * a named group of request/response pairs you can revisit and re-send. The
 * collection name comes from `notes`, or `highlight`, falling back to
 * "vigolium" - so `--matches-to-organizer --notes recon-batch-1` lands every
 * match in one clearly labelled collection.
 */
export async function organizer(ctx: RouteContext, args: Json): Promise<Json> {
  const resolved = await resolveRequest(ctx, args, MAX_SITE_MAP_MESSAGE_BYTES);
  let responseBytes = decodeOptional(args, "http_response_base64");
  const alsoSend = args.send === true;

  const highlight = pickString(args, "highlight").trim().toLowerCase();
  if (highlight && !HIGHLIGHT_COLORS.has(highlight)) {
    throw new BridgeError(
      400,
      "highlight must be one of none, red, orange, yellow, green, cyan, blue, pink, magenta, gray",
    );
  }

  let outcome: SendOutcome | undefined;
  // A supplied response wins; `send` only fetches one when none was given.
  if (alsoSend && responseBytes.length === 0) {
    outcome = await executeSend(ctx, resolved, args, false);
    if (outcome.blocked) throw new BridgeError(403, SCOPE_BLOCKED_MESSAGE);
    if (outcome.responseBytes.length > 0) responseBytes = outcome.responseBytes;
  }
  requireAtMost(responseBytes, MAX_SITE_MAP_MESSAGE_BYTES, "response");

  const notes = sanitizeLabel(pickString(args, "notes"), 200);
  const source = label(args, "source", 80, "vigolium");
  const collectionName =
    notes || (highlight && highlight !== "none" ? highlight : "") || "vigolium";

  const collectionId = await resolveCollectionId(ctx.sdk, collectionName);
  await openInReplay(
    ctx.sdk,
    {
      url: resolved.url,
      requestBytes: resolved.requestBytes,
      responseBytes: responseBytes.length > 0 ? responseBytes : null,
      source,
      roundtripTimeMs: outcome?.elapsedMs,
    },
    notes || source,
    collectionId,
  );
  ctx.log.info(`[Bridge] Added 1 item to Replay collection "${collectionName}" from ${source}`);

  const output: Json = {
    added: 1,
    url: resolved.url,
    request_hash: sha256Hex(resolved.requestBytes),
    has_response: responseBytes.length > 0,
    collection: collectionName,
    message: `added 1 item to Caido Replay collection "${collectionName}"`,
  };
  if (notes) output.notes = notes;
  if (outcome) writeResponseFields(output, outcome);
  return output;
}

// ------------------------------------------------------------------ Registry

/**
 * The one place a bridge route is declared.
 *
 * Handler, body cap and advertised capability used to be three hand-maintained
 * lists across two packages. Missing the cap entry was the dangerous one: the
 * listener rejects the body before the handler ever runs, so the route looked
 * like a client bug rather than a missing table row.
 */
export const BRIDGE_ROUTES: Record<string, BridgeRoute> = {
  "/api/burp-bridge/search": {
    handler: search,
    bodyLimit: MAX_REQUEST_BYTES,
    capability: "search_burp_items",
  },
  "/api/burp-bridge/inspect": {
    handler: inspect,
    bodyLimit: MAX_REQUEST_BYTES,
    capability: "inspect_burp_item",
  },
  "/api/burp-bridge/sitemap": {
    handler: sitemap,
    bodyLimit: MAX_WRITE_BODY_BYTES,
    capability: "add_sitemap_item",
  },
  "/api/burp-bridge/repeater": {
    handler: repeater,
    // Every call opens a visible tab, so this one is capped far lower.
    bodyLimit: MAX_REPEATER_BODY_BYTES,
    capability: "send_to_repeater",
  },
  "/api/burp-bridge/send": {
    handler: send,
    bodyLimit: MAX_WRITE_BODY_BYTES,
    capability: "send_request",
  },
  "/api/burp-bridge/organizer": {
    handler: organizer,
    bodyLimit: MAX_WRITE_BODY_BYTES,
    capability: "add_organizer_item",
  },
};

export function bodyLimitFor(path: string): number {
  return BRIDGE_ROUTES[path]?.bodyLimit ?? MAX_REQUEST_BYTES;
}

// ----------------------------------------------------------------- Internals

type ResolvedRequest = { url: string; requestBytes: Uint8Array };

/**
 * Resolves the target from either a `ref` returned by /search or an explicit
 * url + base64 request body.
 */
async function resolveRequest(
  ctx: RouteContext,
  args: Json,
  maxRequestBytes: number,
): Promise<ResolvedRequest> {
  const inputMode = pickString(args, "input_mode");
  if (inputMode && inputMode !== "burp_base64") {
    throw new BridgeError(400, "input_mode must be burp_base64");
  }

  const ref = pickString(args, "ref").trim();
  let url: string;
  let requestBytes: Uint8Array;

  if (ref) {
    const entry = ctx.refs.require(ref);
    const candidate = await loadCandidate(ctx.sdk, entry.requestId);
    url = candidate.request.getUrl();
    requestBytes = candidate.request.getRaw().toBytes();
  } else {
    url = pickString(args, "url");
    if (!url.trim()) throw new BridgeError(400, "url is required when ref is not supplied");
    requestBytes = decodeRequired(args, "http_request_base64");
  }

  try {
    requireAbsoluteHttpUrl(url);
  } catch (e) {
    throw new BridgeError(400, errorMessage(e));
  }
  if (requestBytes.length > maxRequestBytes) {
    throw new BridgeError(400, `request exceeds ${humanBytes(maxRequestBytes)}`);
  }
  return { url, requestBytes };
}

async function executeSend(
  ctx: RouteContext,
  resolved: ResolvedRequest,
  args: Json,
  save: boolean,
): Promise<SendOutcome> {
  return sendRaw(ctx.sdk, resolved.url, resolved.requestBytes, {
    timeoutMs: readSendTimeout(args),
    enforceInScope: ctx.inScopeOnly(),
    save,
  });
}

function writeResponseFields(output: Json, outcome: SendOutcome): void {
  if (outcome.error) output.error = outcome.error;
  if (outcome.responseBytes.length > 0) {
    const bytes = outcome.responseBytes;
    output.status_code = outcome.statusCode;
    const emitted =
      bytes.length <= MAX_EMBEDDED_RESPONSE_BYTES
        ? bytes
        : bytes.subarray(0, MAX_EMBEDDED_RESPONSE_BYTES);
    output.response_base64 = toBase64(emitted);
    output.response_length = bytes.length;
    output.response_truncated = bytes.length > MAX_EMBEDDED_RESPONSE_BYTES;
    if (outcome.elapsedMs !== undefined) output.elapsed_ms = outcome.elapsedMs;
  }
}

function readSendTimeout(args: Json): number {
  const requested = pickInt(args, "timeout_ms", DEFAULT_SEND_TIMEOUT_MS);
  return Math.max(1, Math.min(requested, MAX_SEND_TIMEOUT_MS));
}

/**
 * Every `http_mode` spelling the Burp listener accepted.
 *
 * Caido's raw-send path frames the supplied bytes as HTTP/1.1 and offers no
 * version selector, so every accepted mode resolves to HTTP_1. That is the mode
 * `--http-mode http1` asks for anyway - the one that matters for smuggling and
 * desync payloads - so the value is validated and echoed honestly rather than
 * pretending to negotiate.
 */
const HTTP_MODES = new Set([
  "",
  "auto",
  "http1",
  "http_1",
  "http/1",
  "http/1.1",
  "http2",
  "http_2",
  "http/2",
  "http2_ignore_alpn",
  "http_2_ignore_alpn",
]);

function parseHttpMode(value: string): string {
  if (!HTTP_MODES.has(value.toLowerCase())) {
    throw new BridgeError(400, "http_mode must be one of auto, http1, http2, http2_ignore_alpn");
  }
  return "HTTP_1";
}

/**
 * Rejects an over-cap message, formatting the limit one way.
 *
 * Used for both a decoded body and one Caido fetched during `send`, so the two
 * paths cannot drift into reporting the same limit differently.
 */
function requireAtMost(bytes: Uint8Array, max: number, what: string): Uint8Array {
  if (bytes.length > max) throw new BridgeError(400, `${what} exceeds ${humanBytes(max)}`);
  return bytes;
}

function decodeOptional(args: Json, name: string): Uint8Array {
  const value = pickString(args, name);
  if (!value.trim()) return new Uint8Array(0);
  try {
    return decodeBase64Strict(value, name);
  } catch (e) {
    throw new BridgeError(400, errorMessage(e));
  }
}

function decodeRequired(args: Json, name: string): Uint8Array {
  const bytes = decodeOptional(args, name);
  if (bytes.length === 0) throw new BridgeError(400, `${name} is required`);
  return bytes;
}

function label(args: Json, name: string, maxLength: number, fallback: string): string {
  const value = sanitizeLabel(pickString(args, name), maxLength);
  return value || fallback;
}

function sanitizeLabel(value: string, maxLength: number): string {
  const sanitized = value.replace(/[\r\n]/g, " ").trim();
  return sanitized.length > maxLength ? sanitized.slice(0, maxLength) : sanitized;
}
