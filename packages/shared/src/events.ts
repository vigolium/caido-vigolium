import type { BridgeStatus, LogEntry, RequestStats, SnapshotStatus } from "./bridge";

/**
 * Backend → frontend push events. Names are kebab-cased so they read clearly in
 * `sdk.backend.onEvent("bridge-status", ...)`.
 */
export type BackendEvents = {
  "bridge-status": (status: BridgeStatus) => void;
  "snapshot-status": (status: SnapshotStatus) => void;
  "request-stats": (stats: RequestStats) => void;
  log: (entry: LogEntry) => void;
};

export const EVENT_BRIDGE_STATUS = "bridge-status";
export const EVENT_SNAPSHOT_STATUS = "snapshot-status";
export const EVENT_REQUEST_STATS = "request-stats";
export const EVENT_LOG = "log";
