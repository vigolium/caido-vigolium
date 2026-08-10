/**
 * Payload budgets derived from the Vigolium server's request body cap.
 *
 * The server rejects bodies over 4 MB on every route except its explicit
 * large-upload endpoints, and traffic travels base64-encoded - which inflates it
 * by 4/3. Anything sizing a payload must therefore budget in *raw* bytes and
 * derive the encoded size, never the other way round.
 *
 * Checking this before sending turns an opaque `413 request body exceeds 4 MB
 * limit` into a message that names the record and its size.
 */
export const SERVER_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

const BASE64_OVERHEAD = 4 / 3;
const ENVELOPE_HEADROOM_BYTES = 256 * 1024;

/** Largest raw payload that still base64-encodes under the server's cap. */
export const MAX_RAW_PAYLOAD_BYTES = Math.floor(
  (SERVER_BODY_LIMIT_BYTES - ENVELOPE_HEADROOM_BYTES) / BASE64_OVERHEAD,
);

export function encodedSize(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

/**
 * Page size for `sdk.requests.query()` cursor walks.
 *
 * Both the bridge search scan and the snapshot collector page the same store, so
 * this is one tuning knob rather than two that can drift apart.
 */
export const REQUEST_PAGE_SIZE = 500;

/** Decimal units, used when reporting a payload against the server's MB caps. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** Binary units, used when reporting a payload against the bridge's own caps. */
export function humanBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.floor(bytes / (1024 * 1024))} MiB`
    : `${Math.floor(bytes / 1024)} KiB`;
}
