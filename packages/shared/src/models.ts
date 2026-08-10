/** Domain objects returned by the Vigolium server API. */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "SUSPECT" | "INFO";

/** Display order, most severe first - also the sort rank. */
export const SEVERITY_ORDER: readonly Severity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "SUSPECT",
  "INFO",
] as const;

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  SUSPECT: "Suspect",
  INFO: "Info",
};

export function parseSeverity(value: string | null | undefined): Severity {
  switch ((value ?? "").toLowerCase()) {
    case "critical":
      return "CRITICAL";
    case "high":
      return "HIGH";
    case "medium":
    case "med":
      return "MEDIUM";
    case "low":
      return "LOW";
    case "suspect":
      return "SUSPECT";
    default:
      return "INFO";
  }
}

export type Finding = {
  id: number;
  httpRecordUuids: string[];
  scanUuid: string;
  moduleId: string;
  moduleName: string;
  description: string;
  severity: Severity;
  confidence: string;
  tags: string[];
  matchedAt: string[];
  foundAt: string;
  request: string;
  response: string;
  moduleType: string;
  moduleShort: string;
  findingSource: string;
  sourceFile: string;
  repoName: string;
  extractedResults: string[];
  additionalEvidence: string[];
  findingHash: string;
  createdAt: string;
};

export type Evidence = { request: string; response: string };

/**
 * Split an `additional_evidence` entry into its request/response halves. Entries
 * use a literal nine-hyphen delimiter line between the two messages.
 */
export function parseEvidence(raw: string | null | undefined): Evidence {
  if (!raw) return { request: "", response: "" };
  const parts = raw.split(/\n-{9}\n/, 2);
  return { request: parts[0] ?? "", response: parts[1] ?? "" };
}

export type HttpRecord = {
  uuid: string;
  scheme: string;
  hostname: string;
  port: number;
  method: string;
  path: string;
  url: string;
  statusCode: number;
  statusPhrase: string;
  responseHttpVersion: string;
  responseContentLength: number;
  responseTimeMs: number;
  sentAt: string;
  createdAt: string;
  source: string;
  riskScore: number;
  /** Raw bytes, base64-encoded exactly as the server returns them. */
  rawRequestBase64: string;
  rawResponseBase64: string;
};

export type Scan = {
  uuid: string;
  name: string;
  status: string;
  scanSource: string;
  scanMode: string;
  sourceType: string;
  modules: string;
  totalFindings: number;
  processedCount: number;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
};

export type ScanLogEntry = {
  id: number;
  scanUuid: string;
  level: string;
  phase: string;
  message: string;
  createdAt: string;
};

export type AgentSession = {
  uuid: string;
  mode: string;
  status: string;
  agentName: string;
  templateId: string;
  targetUrl: string;
  inputType: string;
  currentPhase: string;
  phasesRun: string[];
  findingCount: number;
  recordCount: number;
  savedCount: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  createdAt: string;
};

export type Page<T> = {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type HealthResponse = {
  status: string;
  version: string;
  latencyMs: number;
};

export type FindingsQuery = {
  limit: number;
  offset: number;
  domain?: string;
  severity?: string;
  moduleType?: string;
  findingSource?: string;
  scanId?: string;
  repoName?: string;
  search?: string;
  sort?: string;
  order?: string;
};

export type HttpRecordsQuery = {
  limit: number;
  offset: number;
  domain?: string;
  method?: string;
  path?: string;
  statusCode?: string;
  contentType?: string;
  search?: string;
  source?: string;
  minRisk?: number;
  sort?: string;
  order?: string;
};
