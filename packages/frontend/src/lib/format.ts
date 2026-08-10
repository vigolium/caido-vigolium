import { SEVERITY_LABELS, SEVERITY_ORDER, type BridgeState, type Severity } from "shared";

/**
 * Built once. `toLocaleString()` constructs a formatter per call, which is the
 * expensive part when rendering a few hundred log rows.
 */
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "short",
  timeStyle: "medium",
});

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return TIMESTAMP_FORMAT.format(parsed);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** PrimeVue severity token for a status code, matching Caido's own colouring. */
export function statusSeverity(code: number): string {
  if (code >= 500) return "danger";
  if (code >= 400) return "warn";
  if (code >= 300) return "info";
  if (code >= 200) return "success";
  return "secondary";
}

export function severitySeverity(severity: Severity): string {
  switch (severity) {
    case "CRITICAL":
    case "HIGH":
      return "danger";
    case "MEDIUM":
      return "warn";
    case "LOW":
      return "info";
    default:
      return "secondary";
  }
}

/** PrimeVue severity token for a scan or agent-session status. */
export function scanStatusSeverity(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
    case "success":
      return "success";
    case "running":
      return "info";
    case "failed":
    case "error":
      return "danger";
    case "paused":
      return "warn";
    default:
      return "secondary";
  }
}

export function bridgeStateSeverity(state: BridgeState | undefined): string {
  switch (state) {
    case "LISTENING":
      return "success";
    case "STARTING":
      return "info";
    case "ERROR":
      return "danger";
    default:
      return "secondary";
  }
}

export const SEVERITY_OPTIONS = [
  { label: "All", value: "" },
  ...SEVERITY_ORDER.map((s) => ({ label: SEVERITY_LABELS[s], value: s.toLowerCase() })),
];

export function decodeBase64ToText(value: string): string {
  if (!value) return "";
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // Raw HTTP is byte-oriented; decode as UTF-8 but keep invalid sequences
    // visible rather than throwing.
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return value;
  }
}
