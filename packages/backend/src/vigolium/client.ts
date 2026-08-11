import { createHash } from "crypto";
import { fetch } from "caido:http";
import {
  type AgentSession,
  type Finding,
  type FindingsQuery,
  type HealthResponse,
  type HttpRecord,
  type HttpRecordsQuery,
  type Page,
  type Scan,
  type ScanLogEntry,
  INGEST_SOURCE,
  INGEST_SOURCE_HEADER,
  SERVER_NOT_CONFIGURED_MESSAGE,
  errorMessage,
  parseSeverity,
  serverUnreachableMessage,
} from "shared";
import { pickBoolean, pickNumber, pickString, pickStringList, type Json } from "../util/json";

const MAX_RETRIES = 2;
const BACKOFF_MS = [1000, 2000];

/** Thrown for HTTP-level failures so callers can branch on status (e.g. 409). */
export class VigoliumApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "VigoliumApiError";
    this.statusCode = statusCode;
  }
}

export type ScanRequestPayload = {
  http_request_base64: string;
  http_response_base64?: string | null;
  url: string;
  modules?: string | null;
  timeout?: string | null;
};

export type AgentScanRequestPayload = {
  http_request_base64: string;
  http_response_base64?: string | null;
  url: string;
  save_findings: boolean;
  mode: string;
};

export type IngestPayload = {
  /** The server's only base64 ingestion mode; the name is historical, not Burp-specific. */
  input_mode: "burp_base64";
  url: string;
  http_request_base64: string;
  http_response_base64?: string | null;
};

export type SnapshotRecord = {
  url: string;
  request_base64: string;
  response_base64?: string;
  identity_fingerprint: string;
  content_fingerprint: string;
};

export type SnapshotChunkResponse = {
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
};

type Credentials = () => { serverUrl: string; apiKey: string };

/**
 * Client for the Vigolium server API.
 *
 * Retries transient failures (network errors and 5xx) with the same 1s/2s
 * backoff as the Burp extension, but fails fast on 4xx - a bad API key or a
 * rejected payload will not get better by being sent again.
 */
export class VigoliumApiClient {
  #credentials: Credentials;

  constructor(credentials: Credentials) {
    this.#credentials = credentials;
  }

  // The settings store canonicalises `serverUrl` and `apiKey` on the way in, so
  // nothing here trims or strips a trailing slash. That is what keeps the
  // identity below hashing exactly the credentials requests are sent with -
  // trimming at some call sites and not others silently split the two apart.
  isConfigured(): boolean {
    return this.#credentials().serverUrl.length > 0;
  }

  /** Stable identity of "where records are being sent", for snapshot cache invalidation. */
  async destinationIdentity(): Promise<string> {
    const { serverUrl, apiKey } = this.#credentials();
    return createHash("sha256").update(`${serverUrl}\u0000${apiKey}`).digest("hex");
  }

  async health(): Promise<HealthResponse> {
    const start = Date.now();
    const body = await this.#request("GET", "/health");
    const json = safeJson(body);
    return {
      status: pickString(json, "status", "unknown"),
      version: pickString(json, "version", "unknown"),
      latencyMs: Date.now() - start,
    };
  }

  async ingest(payload: IngestPayload): Promise<void> {
    await this.#request("POST", "/api/ingest-http", payload);
  }

  async scan(payload: ScanRequestPayload): Promise<{ scanId: string; message: string }> {
    const body = await this.#request("POST", "/api/scan-request", payload);
    const json = safeJson(body);
    return {
      scanId: pickString(json, "scan_id", ""),
      message: pickString(json, "message", ""),
    };
  }

  async agentScan(payload: AgentScanRequestPayload): Promise<string> {
    return this.#request("POST", "/api/agent/run/swarm", payload);
  }

  async scanAllRecords(modules: string[], timeout: string | null): Promise<string> {
    const payload: Record<string, unknown> = {};
    if (modules.length > 0) payload.modules = modules;
    if (timeout && timeout.trim()) payload.timeout = timeout.trim();
    const body = await this.#request("POST", "/api/scan-all-records", payload);
    const json = safeJson(body);
    const uuid = pickString(json, "scan_uuid", "");
    return uuid || pickString(json, "scan_id", "");
  }

  async scanRecords(recordUuids: string[], enableModules: string[]): Promise<string> {
    const payload: Record<string, unknown> = { record_uuids: recordUuids };
    if (enableModules.length > 0) payload.enable_modules = enableModules;
    const body = await this.#request("POST", "/api/scan-records", payload);
    return pickString(safeJson(body), "scan_id", "");
  }

  async snapshotSitemap(request: {
    snapshot_id: string;
    chunk_index: number;
    final_chunk: boolean;
    captured_at: string;
    records: SnapshotRecord[];
  }): Promise<SnapshotChunkResponse> {
    const body = await this.#request("POST", "/api/burp/sitemap/snapshot", request);
    const json = safeJson(body);
    return {
      inserted: pickNumber(json, "inserted", 0),
      updated: pickNumber(json, "updated", 0),
      unchanged: pickNumber(json, "unchanged", 0),
      skipped: pickNumber(json, "skipped", 0),
    };
  }

  // ---------------------------------------------------------------- Findings

  async findings(query: FindingsQuery): Promise<Page<Finding>> {
    const path = withQuery("/api/findings", {
      limit: query.limit,
      offset: query.offset,
      domain: query.domain,
      severity: query.severity,
      module_type: query.moduleType,
      finding_source: query.findingSource,
      scan_id: query.scanId,
      repo_name: query.repoName,
      search: query.search,
      sort: query.sort,
      order: query.order,
    });
    const json = safeJson(await this.#request("GET", path));
    return parsePage(json, parseFinding, query.limit, query.offset);
  }

  async findingById(id: number): Promise<Finding> {
    return parseFinding(safeJson(await this.#request("GET", `/api/findings/${id}`)));
  }

  async deleteFinding(id: number): Promise<void> {
    await this.#request("DELETE", `/api/findings/${id}`);
  }

  // ------------------------------------------------------------ HTTP records

  async httpRecords(query: HttpRecordsQuery): Promise<Page<HttpRecord>> {
    const path = withQuery("/api/http-records", {
      limit: query.limit,
      offset: query.offset,
      domain: query.domain,
      method: query.method,
      path: query.path,
      status_code: query.statusCode,
      content_type: query.contentType,
      search: query.search,
      source: query.source,
      min_risk: query.minRisk,
      sort: query.sort,
      order: query.order,
    });
    const json = safeJson(await this.#request("GET", path));
    return parsePage(json, parseHttpRecord, query.limit, query.offset);
  }

  async httpRecordByUuid(uuid: string): Promise<HttpRecord> {
    return parseHttpRecord(safeJson(await this.#request("GET", `/api/http-records/${uuid}`)));
  }

  async deleteHttpRecord(uuid: string): Promise<void> {
    await this.#request("DELETE", `/api/http-records/${uuid}`);
  }

  // ------------------------------------------------------------------- Scans

  async scans(limit: number, offset: number): Promise<Page<Scan>> {
    const json = safeJson(await this.#request("GET", withQuery("/api/scans", { limit, offset })));
    return parsePage(json, parseScan, limit, offset);
  }

  async stopScan(uuid: string): Promise<void> {
    await this.#request("POST", `/api/scans/${uuid}/stop`, {});
  }

  async pauseScan(uuid: string): Promise<void> {
    await this.#request("POST", `/api/scans/${uuid}/pause`, {});
  }

  async resumeScan(uuid: string): Promise<void> {
    await this.#request("POST", `/api/scans/${uuid}/resume`, {});
  }

  async deleteScan(uuid: string): Promise<void> {
    await this.#request("DELETE", `/api/scans/${uuid}`);
  }

  async scanLogs(
    scanUuid: string,
    level: string | undefined,
    phase: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ logs: ScanLogEntry[]; total: number }> {
    const path = withQuery(`/api/scans/${scanUuid}/logs`, { limit, offset, level, phase });
    const json = safeJson(await this.#request("GET", path));
    const logs = asArray(json.logs).map((entry) => ({
      id: pickNumber(entry, "id", 0),
      scanUuid: pickString(entry, "scan_uuid", ""),
      level: pickString(entry, "level", ""),
      phase: pickString(entry, "phase", ""),
      message: pickString(entry, "message", ""),
      createdAt: pickString(entry, "created_at", ""),
    }));
    return { logs, total: pickNumber(json, "total", logs.length) };
  }

  // ---------------------------------------------------------- Agent sessions

  async agentSessions(
    mode: string | undefined,
    limit: number,
    offset: number,
  ): Promise<Page<AgentSession>> {
    const path = withQuery("/api/agent/sessions", { limit, offset, mode });
    const json = safeJson(await this.#request("GET", path));
    return parsePage(json, parseAgentSession, limit, offset);
  }

  async agentSessionLogs(sessionId: string): Promise<string> {
    return this.#request("GET", withQuery(`/api/agent/sessions/${sessionId}/logs`, { strip: 1 }));
  }

  // ----------------------------------------------------------------- Internal

  async #request(method: string, path: string, body?: unknown): Promise<string> {
    const { serverUrl, apiKey } = this.#credentials();
    if (!serverUrl) throw new VigoliumApiError(0, SERVER_NOT_CONFIGURED_MESSAGE);

    const headers: Record<string, string> = {
      // Set on every call rather than only on the ingest path: it is advisory
      // (the server allowlists it and falls back to `ingest-server`), and a
      // per-endpoint opt-in is the kind of thing a new dispatch route silently
      // forgets. Without it, traffic pushed from Caido is indistinguishable
      // from traffic pushed by curl.
      [INGEST_SOURCE_HEADER]: INGEST_SOURCE,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    let init: Record<string, unknown> = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init = { ...init, body: JSON.stringify(body) };
    }

    let lastError = "unknown error";
    // Both kinds of failure are retried the same way, but they do not read the
    // same way: a throw out of `fetch` means nothing answered, while a 5xx means
    // the server answered badly. Only the first is fixed by starting the server,
    // so which one it was is carried out of the loop rather than recovered later
    // by string-matching whatever wording the transport happened to use.
    let unreachable = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(BACKOFF_MS[attempt - 1] ?? 2000);
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await fetch(`${serverUrl}${path}`, init as any);
        const text = await response.text();
        if (response.ok) return text;

        if (response.status >= 400 && response.status < 500) {
          throw new VigoliumApiError(
            response.status,
            `API error: ${response.status} - ${text.trim()}`,
          );
        }
        lastError = `Server error: ${response.status} - ${text.trim()}`;
        unreachable = false;
      } catch (e) {
        if (e instanceof VigoliumApiError) throw e;
        lastError = errorMessage(e);
        unreachable = true;
      }
    }
    throw new VigoliumApiError(
      0,
      unreachable
        ? serverUnreachableMessage(serverUrl, lastError)
        : `Request failed after ${MAX_RETRIES} retries: ${lastError}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------------- Parsing

function safeJson(body: string): Json {
  if (!body.trim()) return {};
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value)
    ? value.filter((v): v is Json => typeof v === "object" && v !== null)
    : [];
}

/**
 * Every list endpoint answers with the same envelope around `data`, including
 * the limit and offset it actually applied - which is not always the requested
 * one, so the echo is preferred and the request only supplies the fallback.
 */
function parsePage<T>(
  json: Json,
  parse: (entry: Json) => T,
  limit: number,
  offset: number,
): Page<T> {
  return {
    data: asArray(json.data).map(parse),
    total: pickNumber(json, "total", 0),
    limit: pickNumber(json, "limit", limit),
    offset: pickNumber(json, "offset", offset),
    hasMore: pickBoolean(json, "has_more", false),
  };
}

function parseFinding(json: Json): Finding {
  return {
    id: pickNumber(json, "id", 0),
    httpRecordUuids: pickStringList(json, "http_record_uuids"),
    scanUuid: pickString(json, "scan_uuid", ""),
    moduleId: pickString(json, "module_id", ""),
    moduleName: pickString(json, "module_name", ""),
    description: pickString(json, "description", ""),
    severity: parseSeverity(pickString(json, "severity", "")),
    confidence: pickString(json, "confidence", ""),
    tags: pickStringList(json, "tags"),
    matchedAt: pickStringList(json, "matched_at"),
    foundAt: pickString(json, "found_at", ""),
    request: pickString(json, "request", ""),
    response: pickString(json, "response", ""),
    moduleType: pickString(json, "module_type", ""),
    moduleShort: pickString(json, "module_short", ""),
    findingSource: pickString(json, "finding_source", ""),
    sourceFile: pickString(json, "source_file", ""),
    repoName: pickString(json, "repo_name", ""),
    extractedResults: pickStringList(json, "extracted_results"),
    additionalEvidence: pickStringList(json, "additional_evidence"),
    findingHash: pickString(json, "finding_hash", ""),
    createdAt: pickString(json, "created_at", ""),
  };
}

function parseHttpRecord(json: Json): HttpRecord {
  return {
    uuid: pickString(json, "uuid", ""),
    scheme: pickString(json, "scheme", ""),
    hostname: pickString(json, "hostname", ""),
    port: pickNumber(json, "port", 0),
    method: pickString(json, "method", ""),
    path: pickString(json, "path", ""),
    url: pickString(json, "url", ""),
    statusCode: pickNumber(json, "status_code", 0),
    statusPhrase: pickString(json, "status_phrase", ""),
    responseHttpVersion: pickString(json, "response_http_version", ""),
    responseContentLength: pickNumber(json, "response_content_length", 0),
    responseTimeMs: pickNumber(json, "response_time_ms", 0),
    sentAt: pickString(json, "sent_at", ""),
    createdAt: pickString(json, "created_at", ""),
    source: pickString(json, "source", ""),
    riskScore: pickNumber(json, "risk_score", 0),
    // Left base64-encoded: the frontend renders them through Caido's editors,
    // and decoding here would force a lossy string round trip.
    rawRequestBase64: pickString(json, "raw_request", ""),
    rawResponseBase64: pickString(json, "raw_response", ""),
  };
}

function parseScan(json: Json): Scan {
  return {
    uuid: pickString(json, "uuid", ""),
    name: pickString(json, "name", ""),
    status: pickString(json, "status", ""),
    scanSource: pickString(json, "scan_source", ""),
    scanMode: pickString(json, "scan_mode", ""),
    sourceType: pickString(json, "source_type", ""),
    modules: pickString(json, "modules", ""),
    totalFindings: pickNumber(json, "total_findings", 0),
    processedCount: pickNumber(json, "processed_count", 0),
    startedAt: pickString(json, "started_at", ""),
    finishedAt: pickString(json, "finished_at", ""),
    createdAt: pickString(json, "created_at", ""),
  };
}

function parseAgentSession(json: Json): AgentSession {
  return {
    uuid: pickString(json, "uuid", ""),
    mode: pickString(json, "mode", ""),
    status: pickString(json, "status", ""),
    agentName: pickString(json, "agent_name", ""),
    templateId: pickString(json, "template_id", ""),
    targetUrl: pickString(json, "target_url", ""),
    inputType: pickString(json, "input_type", ""),
    currentPhase: pickString(json, "current_phase", ""),
    phasesRun: pickStringList(json, "phases_run"),
    findingCount: pickNumber(json, "finding_count", 0),
    recordCount: pickNumber(json, "record_count", 0),
    savedCount: pickNumber(json, "saved_count", 0),
    durationMs: pickNumber(json, "duration_ms", 0),
    startedAt: pickString(json, "started_at", ""),
    completedAt: pickString(json, "completed_at", ""),
    createdAt: pickString(json, "created_at", ""),
  };
}

function withQuery(path: string, params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (!text.trim()) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
  }
  return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
}
