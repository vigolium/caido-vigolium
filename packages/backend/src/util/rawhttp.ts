import { toLatin1 } from "./bytes";

/**
 * Just enough raw-HTTP parsing to describe a message to Caido.
 *
 * Caido's `createRequest` wants the structured fields (method, path, query,
 * status code) alongside the raw bytes. The raw bytes remain authoritative and
 * are stored verbatim - this only derives the metadata columns, so a
 * deliberately malformed request still round-trips byte-for-byte.
 */

export type ParsedRequestLine = {
  method: string;
  path: string;
  query: string;
};

export function parseRequestLine(bytes: Uint8Array): ParsedRequestLine {
  // 8 KiB is far beyond any real request line; bounding the decode keeps a
  // large body from being turned into a string just to read its first line.
  const head = toLatin1(bytes, 8192);
  const lineEnd = head.search(/\r?\n/);
  const line = lineEnd >= 0 ? head.slice(0, lineEnd) : head;
  const parts = line.split(" ");

  const method = (parts[0] ?? "GET").trim() || "GET";
  const target = (parts[1] ?? "/").trim() || "/";

  const queryStart = target.indexOf("?");
  if (queryStart < 0) return { method, path: target, query: "" };
  return {
    method,
    path: target.slice(0, queryStart),
    query: target.slice(queryStart + 1),
  };
}

export function parseStatusCode(bytes: Uint8Array): number {
  const head = toLatin1(bytes, 256);
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(head);
  return match?.[1] ? Number(match[1]) : 0;
}

/** The `Host` header, or "" when the message carries none. */
export function parseHostHeader(bytes: Uint8Array): string {
  const head = toLatin1(bytes, 8192);
  // Stop at the blank line: a body may well contain something that looks like a
  // header, and only the real ones name the target.
  const headers = head.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const match = /^host:[ \t]*(\S+)[ \t]*$/im.exec(headers);
  return match?.[1] ?? "";
}

/**
 * The absolute URL a stored raw request was aimed at.
 *
 * Evidence carries the message but not the connection it was made over, so the
 * authority has to be recovered from the `Host` header and the scheme from
 * whatever the caller already knows - a finding's `matchedAt`, say, which may
 * equally be a source-file path and no help at all. Each half therefore falls
 * back to the other, and an absolute request-target, being unambiguous, wins
 * over both.
 */
export function deriveRequestUrl(bytes: Uint8Array, hint: string): string {
  const { path, query } = parseRequestLine(bytes);
  const suffix = query ? `${path}?${query}` : path;

  if (/^https?:\/\//i.test(path)) return suffix;

  const hinted = parseHint(hint);
  const host = parseHostHeader(bytes);
  if (!host) {
    if (!hinted) throw new Error("Cannot tell where this request was sent: no Host header");
    return `${hinted.origin}${suffix}`;
  }

  // An explicit default port is the strongest signal about the scheme, ahead of
  // a hint that may describe a different endpoint entirely.
  const scheme = host.endsWith(":80")
    ? "http"
    : host.endsWith(":443")
      ? "https"
      : (hinted?.protocol.replace(":", "") ?? "https");
  return `${scheme}://${host}${suffix}`;
}

function parseHint(hint: string): URL | undefined {
  try {
    const parsed = new URL(hint);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export type TargetInfo = {
  host: string;
  port: number;
  isTls: boolean;
};

export function parseTarget(url: string): TargetInfo {
  const parsed = new URL(url);
  const isTls = parsed.protocol === "https:";
  const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
  return { host: parsed.hostname, port, isTls };
}

/**
 * Validates a bridge target URL. Callers must reject anything that is not an
 * absolute http/https URL before it reaches Caido.
 */
export function requireAbsoluteHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("url must be an absolute http or https URL");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new Error("url must be an absolute http or https URL");
  }
  return url;
}
