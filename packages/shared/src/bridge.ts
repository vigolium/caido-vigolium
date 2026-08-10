/** Status objects surfaced from backend services to the Bridge and Settings tabs. */

export type BridgeState = "DISABLED" | "STARTING" | "LISTENING" | "ERROR";

export type BridgeStatus = {
  state: BridgeState;
  message: string;
  listenUrl: string;
  startedAt: string | null;
  lastRequestAt: string | null;
  /**
   * Caido scopes requests to the selected project, so search results change when
   * the user switches projects. Reported here (and on /health) to keep bridge
   * output explainable.
   */
  projectId: string | null;
  projectName: string | null;
  /** True when the listener runs in-process; false when a sidecar owns the port. */
  inProcess: boolean;
};

export type SnapshotState = "IDLE" | "DISABLED" | "RUNNING" | "SUCCESS" | "FAILED";

export type SnapshotStatus = {
  state: SnapshotState;
  message: string;
  discovered: number;
  uploaded: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  completedAt: string | null;
  nextRunAt: string | null;
};

export type ConnectionTestResult = {
  successful: boolean;
  message: string;
};

export type Counters = {
  sent: number;
  pending: number;
  failed: number;
};

export type RequestStats = {
  ingest: Counters;
  scan: Counters;
};

export const EMPTY_COUNTERS: Counters = { sent: 0, pending: 0, failed: 0 };

export type LogLevel = "INFO" | "WARN" | "ERROR";

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
};

/**
 * Ring-buffer cap for the activity log, shared so the frontend mirror never
 * truncates history the backend is still willing to hand out.
 */
export const MAX_LOG_ENTRIES = 2000;

export const MAX_REPEATER_TABS_PER_MINUTE = 30;

/**
 * Protocol identifier, reported on /health.
 *
 * Deliberately Burp-spelled and identical in both integrations: tooling sniffs
 * this field to recognise the bridge protocol, so it says which protocol is
 * spoken, not who speaks it.
 */
export const BRIDGE_SERVICE = "vigolium-burp-bridge";

/**
 * Who actually answered.
 *
 * The only field that distinguishes this plugin from the Burp extension. Vigolium
 * maps it, through a closed allowlist, to the `source` label it stamps on every
 * record pulled over the bridge - which is why the CLI can show `caido` in the
 * traffic Source column instead of labelling everything `burp`.
 *
 * Echoed on /search and /inspect as well as /health so the read path needs no
 * extra round trip, and so a single-record inspect (which has no preceding
 * search to learn the vendor from) still labels correctly. A reply that omits
 * it is read as the Burp extension, so this constant must never be dropped or
 * renamed without a matching entry in Vigolium's allowlist.
 */
export const BRIDGE_IMPLEMENTATION = "vigolium-caido-bridge";

/**
 * Declares the pushing tool on POST /api/ingest-http, so traffic sent to the
 * Vigolium server lands as `source: "caido"` rather than the generic
 * `ingest-server` every HTTP client shares. Same label the bridge path uses, so
 * one `--source caido` filter covers traffic that arrived either way.
 */
export const INGEST_SOURCE_HEADER = "X-Vigolium-Source";
export const INGEST_SOURCE = "caido";
