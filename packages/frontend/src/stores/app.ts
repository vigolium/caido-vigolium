import { reactive, readonly } from "vue";
import {
  DEFAULT_SETTINGS,
  EMPTY_COUNTERS,
  EVENT_BRIDGE_STATUS,
  EVENT_LOG,
  EVENT_REQUEST_STATS,
  EVENT_SNAPSHOT_STATUS,
  MAX_LOG_ENTRIES,
  type BridgeStatus,
  type LogEntry,
  type RequestStats,
  type SnapshotStatus,
  type VigoliumSettings,
} from "shared";
import type { FrontendSDK } from "../types";

/**
 * One shared, backend-fed store for state that more than one tab reads.
 *
 * The backend is the single source of truth - it owns the settings database,
 * the listener and the counters - so the frontend mirrors what it pushes rather
 * than keeping its own copy in sync.
 */
type State = {
  settings: VigoliumSettings;
  bridge: BridgeStatus | undefined;
  snapshot: SnapshotStatus | undefined;
  stats: RequestStats;
  logs: LogEntry[];
  ready: boolean;
};

const state = reactive<State>({
  settings: structuredClone(DEFAULT_SETTINGS),
  bridge: undefined,
  snapshot: undefined,
  stats: { ingest: { ...EMPTY_COUNTERS }, scan: { ...EMPTY_COUNTERS } },
  logs: [],
  ready: false,
});

export const appState = readonly(state);

export async function initStore(sdk: FrontendSDK): Promise<void> {
  const [settings, bridge, snapshot, stats, logs] = await Promise.all([
    sdk.backend.getSettings(),
    sdk.backend.getBridgeStatus(),
    sdk.backend.getSnapshotStatus(),
    sdk.backend.getRequestStats(),
    sdk.backend.getLogs(),
  ]);
  state.settings = settings;
  state.bridge = bridge;
  state.snapshot = snapshot;
  state.stats = stats;
  state.logs = logs;
  state.ready = true;

  sdk.backend.onEvent(EVENT_BRIDGE_STATUS, (status) => {
    state.bridge = status;
  });
  sdk.backend.onEvent(EVENT_SNAPSHOT_STATUS, (status) => {
    state.snapshot = status;
  });
  sdk.backend.onEvent(EVENT_REQUEST_STATS, (next) => {
    state.stats = next;
  });
  sdk.backend.onEvent(EVENT_LOG, (entry) => {
    state.logs.push(entry);
    // Mirrors the backend's ring buffer, so both keep the same history.
    if (state.logs.length > MAX_LOG_ENTRIES) {
      state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES);
    }
  });
}

export async function saveSettings(
  sdk: FrontendSDK,
  patch: Partial<VigoliumSettings>,
): Promise<void> {
  state.settings = await sdk.backend.updateSettings(patch);
}

export async function refreshLogs(sdk: FrontendSDK): Promise<void> {
  state.logs = await sdk.backend.getLogs();
}

export async function clearLogs(sdk: FrontendSDK): Promise<void> {
  await sdk.backend.clearLogs();
  state.logs = [];
}

export async function resetStats(sdk: FrontendSDK): Promise<void> {
  state.stats = await sdk.backend.resetRequestStats();
}
