import { Buffer } from "buffer";
import { createHash } from "crypto";

/**
 * Zero-copy `Buffer` view over the same memory.
 *
 * `Buffer.from(uint8Array)` copies. Every raw request and response in the
 * project passes through here on each snapshot and on every proxied exchange, so
 * the copy is a full duplicate of the traffic store per pass.
 */
export function view(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function toBase64(bytes: Uint8Array): string {
  return view(bytes).toString("base64");
}

export function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/**
 * Base64 that rejects malformed input.
 *
 * `Buffer.from(..., "base64")` silently discards invalid characters, which would
 * turn a corrupted request body into a plausible-looking but wrong set of bytes.
 * The bridge must reject those instead, matching the Java listener's behaviour.
 */
export function decodeBase64Strict(value: string, field: string): Uint8Array {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new Error(`${field} is not valid base64`);
  }
  return fromBase64(trimmed);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(view(bytes)).digest("hex");
}

/** Latin-1 round trip: one byte per char, so binary survives the string form. */
export function toLatin1(bytes: Uint8Array, maxBytes?: number): string {
  const slice = maxBytes !== undefined ? bytes.subarray(0, maxBytes) : bytes;
  return view(slice).toString("latin1");
}

export function fromLatin1(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "latin1"));
}
