import type { DefineAPI, DefineEvents, SDK } from "caido:plugin";
import {
  type AgentSession,
  type BackendEvents,
  type BridgeStatus,
  type ConnectionTestResult,
  type Finding,
  type FindingsQuery,
  type HealthResponse,
  type HttpRecord,
  type HttpRecordsQuery,
  type LogEntry,
  type Page,
  type RequestStats,
  type Scan,
  type ScanLogEntry,
  type SnapshotStatus,
  type VigoliumSettings,
  EVENT_REQUEST_STATS,
  errorMessage,
  type DispatchKind,
  type RawDispatchInput,
} from "shared";
import { openInReplay } from "./bridge/caido";
import { BridgeService } from "./bridge/service";
import { RequestCounters } from "./counters";
import { publish } from "./events";
import { fromBase64, fromUtf8 } from "./util/bytes";
import { deriveRequestUrl } from "./util/rawhttp";
import { LogService } from "./logging";
import { ProxyForwarder } from "./proxy/forwarder";
import { SettingsStore, blankToNull, splitModules } from "./settings";
import { SnapshotService } from "./snapshot/service";
import { VigoliumApiClient, VigoliumApiError } from "./vigolium/client";
import { DispatchService } from "./vigolium/dispatch";

/**
 * Backend services are constructed once in `init` and captured by the RPC
 * closures below. Keeping them module-scoped would survive a plugin reload with
 * stale handles; this way every load gets a clean graph.
 */
type Services = {
  settings: SettingsStore;
  log: LogService;
  api: VigoliumApiClient;
  bridge: BridgeService;
  snapshot: SnapshotService;
  dispatch: DispatchService;
  ingestCounters: RequestCounters;
  scanCounters: RequestCounters;
};

let services: Services | undefined;

function required(): Services {
  if (!services) throw new Error("Vigolium backend is not initialised");
  return services;
}

// ------------------------------------------------------------- RPC surface

async function getSettings(): Promise<VigoliumSettings> {
  return required().settings.get();
}

async function updateSettings(
  _sdk: SDK,
  patch: Partial<VigoliumSettings>,
): Promise<VigoliumSettings> {
  return required().settings.update(patch);
}

async function testServerConnection(): Promise<
  { ok: true; health: HealthResponse } | { ok: false; message: string }
> {
  try {
    return { ok: true, health: await required().api.health() };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

async function testBridgeConnection(): Promise<ConnectionTestResult> {
  return required().bridge.testConnection();
}

async function restartBridge(): Promise<BridgeStatus> {
  const { bridge } = required();
  await bridge.restart();
  return bridge.status();
}

async function getBridgeStatus(): Promise<BridgeStatus> {
  return required().bridge.status();
}

async function getSnapshotStatus(): Promise<SnapshotStatus> {
  return required().snapshot.status();
}

async function snapshotNow(_sdk: SDK, source: string): Promise<SnapshotStatus> {
  return required().snapshot.snapshotNow(source || "Manual");
}

async function rescheduleSnapshot(): Promise<SnapshotStatus> {
  const { snapshot } = required();
  snapshot.reschedule();
  return snapshot.status();
}

async function getRequestStats(): Promise<RequestStats> {
  const { ingestCounters, scanCounters } = required();
  return { ingest: ingestCounters.snapshot(), scan: scanCounters.snapshot() };
}

async function resetRequestStats(): Promise<RequestStats> {
  const { ingestCounters, scanCounters } = required();
  ingestCounters.reset();
  scanCounters.reset();
  return getRequestStats();
}

async function getLogs(): Promise<LogEntry[]> {
  return required().log.entries();
}

async function clearLogs(): Promise<void> {
  required().log.clear();
}

async function dispatch(
  _sdk: SDK,
  kind: DispatchKind,
  ids: string[],
  source: string,
): Promise<number> {
  return required().dispatch.dispatchIds(kind, ids, source);
}

async function dispatchRaw(
  _sdk: SDK,
  kind: DispatchKind,
  inputs: RawDispatchInput[],
  source: string,
): Promise<number> {
  return required().dispatch.dispatchRaw(kind, inputs, source);
}

async function findings(_sdk: SDK, query: FindingsQuery): Promise<Page<Finding>> {
  return required().api.findings(query);
}

async function findingById(_sdk: SDK, id: number): Promise<Finding> {
  return required().api.findingById(id);
}

async function deleteFinding(_sdk: SDK, id: number): Promise<void> {
  return required().api.deleteFinding(id);
}

async function httpRecords(_sdk: SDK, query: HttpRecordsQuery): Promise<Page<HttpRecord>> {
  return required().api.httpRecords(query);
}

async function httpRecordByUuid(_sdk: SDK, uuid: string): Promise<HttpRecord> {
  return required().api.httpRecordByUuid(uuid);
}

async function deleteHttpRecord(_sdk: SDK, uuid: string): Promise<void> {
  return required().api.deleteHttpRecord(uuid);
}

async function scanRecord(_sdk: SDK, uuid: string): Promise<string> {
  const { api, settings } = required();
  return api.scanRecords([uuid], settings.moduleList());
}

async function scanAllRecords(_sdk: SDK, modules: string, timeout: string): Promise<string> {
  return required().api.scanAllRecords(splitModules(modules), blankToNull(timeout));
}

async function scans(_sdk: SDK, limit: number, offset: number): Promise<Page<Scan>> {
  return required().api.scans(limit, offset);
}

async function scanLogs(
  _sdk: SDK,
  scanUuid: string,
  level: string,
  phase: string,
  limit: number,
  offset: number,
): Promise<{ logs: ScanLogEntry[]; total: number }> {
  return required().api.scanLogs(scanUuid, level || undefined, phase || undefined, limit, offset);
}

async function pauseScan(_sdk: SDK, uuid: string): Promise<void> {
  return required().api.pauseScan(uuid);
}

async function resumeScan(_sdk: SDK, uuid: string): Promise<void> {
  return required().api.resumeScan(uuid);
}

async function stopScan(_sdk: SDK, uuid: string): Promise<void> {
  return required().api.stopScan(uuid);
}

async function deleteScan(_sdk: SDK, uuid: string): Promise<void> {
  return required().api.deleteScan(uuid);
}

async function agentSessions(
  _sdk: SDK,
  mode: string,
  limit: number,
  offset: number,
): Promise<Page<AgentSession>> {
  return required().api.agentSessions(mode || undefined, limit, offset);
}

async function agentSessionLogs(_sdk: SDK, sessionId: string): Promise<string> {
  return required().api.agentSessionLogs(sessionId);
}

/** Opens a stored Vigolium record in Caido Replay. */
async function sendRecordToReplay(sdk: SDK, uuid: string): Promise<string> {
  const { api, log } = required();
  const record = await api.httpRecordByUuid(uuid);
  if (!record.rawRequestBase64) {
    throw new VigoliumApiError(0, "Record has no raw request to replay");
  }
  const sessionId = await openInReplay(
    sdk,
    {
      url: record.url,
      requestBytes: fromBase64(record.rawRequestBase64),
      responseBytes: record.rawResponseBase64 ? fromBase64(record.rawResponseBase64) : null,
      source: "vigolium-record",
      roundtripTimeMs: record.responseTimeMs,
    },
    `vigolium-${record.uuid.slice(0, 8)}`,
  );
  log.info(`[HTTP Records] Opened Replay session for ${record.url}`);
  return sessionId;
}

/**
 * Opens a raw message in Caido Replay - a finding's evidence, which has no
 * stored record behind it to look up.
 *
 * `urlHint` is the caller's best guess at the target, typically a finding's
 * `matchedAt`. It is only a hint because that field is not always a URL at all:
 * an agent finding matches a source file. The message itself is the better
 * authority, so the two are reconciled rather than one being trusted outright.
 */
async function sendRawToReplay(
  sdk: SDK,
  urlHint: string,
  request: string,
  response: string,
  name: string,
): Promise<string> {
  const { log } = required();
  const requestBytes = fromUtf8(request);
  if (requestBytes.length === 0) {
    throw new VigoliumApiError(0, "There is no request to replay");
  }

  const url = deriveRequestUrl(requestBytes, urlHint);
  const responseBytes = response ? fromUtf8(response) : null;
  const sessionId = await openInReplay(
    sdk,
    {
      url,
      requestBytes,
      responseBytes: responseBytes && responseBytes.length > 0 ? responseBytes : null,
      source: "vigolium-evidence",
    },
    name || "vigolium",
  );
  log.info(`[Findings] Opened Replay session for ${url}`);
  return sessionId;
}

/**
 * The RPC surface, declared once.
 *
 * `DefineAPI` maps over this record, so the type and the registration loop below
 * read from the same list - adding a method to one and forgetting the other used
 * to give either an unregistered call or an untyped one.
 */
const HANDLERS = {
  getSettings,
  updateSettings,
  testServerConnection,
  testBridgeConnection,
  restartBridge,
  getBridgeStatus,
  getSnapshotStatus,
  snapshotNow,
  rescheduleSnapshot,
  getRequestStats,
  resetRequestStats,
  getLogs,
  clearLogs,
  dispatch,
  dispatchRaw,
  findings,
  findingById,
  deleteFinding,
  httpRecords,
  httpRecordByUuid,
  deleteHttpRecord,
  scanRecord,
  scanAllRecords,
  scans,
  scanLogs,
  pauseScan,
  resumeScan,
  stopScan,
  deleteScan,
  agentSessions,
  agentSessionLogs,
  sendRecordToReplay,
  sendRawToReplay,
};

export type API = DefineAPI<typeof HANDLERS>;

export type { BackendEvents };
type Events = DefineEvents<BackendEvents>;

export async function init(sdk: SDK<API, Events>): Promise<void> {
  const settings = new SettingsStore(sdk);
  await settings.init();

  const log = new LogService(sdk);
  const api = new VigoliumApiClient(() => {
    const current = settings.get();
    return { serverUrl: current.serverUrl, apiKey: current.apiKey };
  });

  const ingestCounters = new RequestCounters();
  const scanCounters = new RequestCounters();
  const publishStats = () =>
    publish(sdk, EVENT_REQUEST_STATS, {
      ingest: ingestCounters.snapshot(),
      scan: scanCounters.snapshot(),
    });
  ingestCounters.setOnChange(publishStats);
  scanCounters.setOnChange(publishStats);

  const bridge = new BridgeService(sdk, settings, log);
  const snapshot = new SnapshotService(sdk, settings, api, log);
  const dispatchService = new DispatchService(
    sdk,
    api,
    log,
    settings,
    ingestCounters,
    scanCounters,
  );
  const forwarder = new ProxyForwarder(api, log, settings, ingestCounters);

  services = {
    settings,
    log,
    api,
    bridge,
    snapshot,
    dispatch: dispatchService,
    ingestCounters,
    scanCounters,
  };

  for (const [name, callback] of Object.entries(HANDLERS)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdk.api.register(name as any, callback as any);
  }

  sdk.events.onInterceptResponse((eventSdk, request, response) =>
    forwarder.handle(eventSdk, request, response),
  );

  sdk.events.onProjectChange((_eventSdk, project) => {
    bridge.onProjectChange(project ? { id: project.getId(), name: project.getName() } : null);
  });

  // Restarting the listener and the snapshot timer on any settings change keeps
  // one code path responsible for their lifecycle.
  let lastBridgeKey = bridgeKey(settings.get());
  let lastSnapshotKey = snapshotKey(settings.get());
  settings.onChange((next) => {
    const nextBridgeKey = bridgeKey(next);
    if (nextBridgeKey !== lastBridgeKey) {
      lastBridgeKey = nextBridgeKey;
      void bridge.restart();
    }
    const nextSnapshotKey = snapshotKey(next);
    if (nextSnapshotKey !== lastSnapshotKey) {
      lastSnapshotKey = nextSnapshotKey;
      snapshot.reschedule();
    }
  });

  // Independent of each other, so they overlap rather than adding two round
  // trips to every plugin load. `onProjectChange` republishes the bridge status,
  // so it is safe whichever order they land in.
  //
  // Seeding the project matters because `onProjectChange` only fires on a
  // *change* - without it /health would report a null project for the whole
  // first session.
  const [current] = await Promise.all([sdk.projects.getCurrent(), bridge.restart()]);
  bridge.onProjectChange(current ? { id: current.getId(), name: current.getName() } : null);
  snapshot.start();

  log.info(`Plugin v${sdk.meta.version()} loaded successfully.`);
}

function bridgeKey(settings: VigoliumSettings): string {
  return `${settings.bridgeEnabled}|${settings.bridgeListenUrl}`;
}

function snapshotKey(settings: VigoliumSettings): string {
  return `${settings.snapshotAutoEnabled}|${settings.snapshotIntervalMinutes}`;
}
