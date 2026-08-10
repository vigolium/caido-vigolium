/**
 * Listener address parsing and Host/Origin validation.
 *
 * The bridge is unauthenticated, so its only defences are that it binds
 * loopback exclusively and refuses requests whose Host or Origin does not match
 * the address it was configured with. That second check is what stops a web
 * page in the user's browser from driving the listener via DNS rebinding.
 */

export type ListenAddress = {
  /** Address to bind, normalised (e.g. "localhost" resolves to 127.0.0.1). */
  host: string;
  port: number;
  /** Host exactly as the user configured it, still accepted in a Host header. */
  configuredHost: string;
};

export function parseListenUrl(value: string): ListenAddress {
  const trimmed = (value ?? "").trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Bridge listener URL must be a valid http:// URL");
  }
  if (url.protocol !== "http:") {
    throw new Error("Bridge listener URL must use http://");
  }
  if (url.pathname && url.pathname !== "/") {
    throw new Error("Bridge listener URL must not include a path");
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error("Bridge listener URL must not include credentials, a query, or a fragment");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Bridge listener URL must include a host and port");
  }

  const configuredHost = stripBrackets(url.hostname).toLowerCase();
  const bindHost = resolveLoopback(configuredHost);
  if (bindHost === undefined) {
    throw new Error("Bridge listener must bind to a loopback address");
  }
  return { host: bindHost, port, configuredHost };
}

/**
 * Maps a hostname to the loopback address it denotes, or undefined when it is
 * not loopback. Only literal loopback names and addresses are accepted - an
 * arbitrary hostname is refused rather than resolved, so DNS can never point
 * the listener off-host.
 */
function resolveLoopback(host: string): string | undefined {
  if (host === "localhost") return "127.0.0.1";
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "::1";
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    const octets = host.split(".").map(Number);
    if (octets.every((o) => o >= 0 && o <= 255)) return host;
  }
  return undefined;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Canonical hostname form: lowercased, unbracketed, no trailing root dot.
 *
 * Shared with the search host glob rather than reimplemented there - the two
 * gate the DNS-rebinding check and scope matching respectively, so a form one
 * accepts and the other does not is exactly the divergence worth preventing.
 */
export function normalizeHost(host: string | undefined): string {
  let value = (host ?? "").trim().toLowerCase();
  value = stripBrackets(value);
  while (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

type Authority = { host: string; port: number };

function parseAuthority(value: string | undefined, defaultPort: number): Authority | undefined {
  if (!value || !value.trim() || value.includes(",")) return undefined;
  let url: URL;
  try {
    url = new URL(`http://${value.trim()}`);
  } catch {
    return undefined;
  }
  if (!url.hostname || url.username || url.password) return undefined;
  if (url.pathname && url.pathname !== "/") return undefined;
  if (url.search || url.hash) return undefined;
  // `new URL` invents a "/" pathname; only a literal path in the input is a problem.
  if (value.includes("/")) return undefined;
  const port = url.port ? Number(url.port) : defaultPort;
  if (!Number.isInteger(port)) return undefined;
  return { host: stripBrackets(url.hostname), port };
}

export class BridgeBinding {
  #listen: ListenAddress;

  constructor(listen: ListenAddress) {
    this.#listen = listen;
  }

  acceptsHost(hostHeader: string | undefined): boolean {
    const authority = parseAuthority(hostHeader, 80);
    if (!authority || authority.port !== this.#listen.port) return false;
    const requested = normalizeHost(authority.host);
    return (
      requested === normalizeHost(this.#listen.configuredHost) ||
      requested === normalizeHost(this.#listen.host)
    );
  }

  acceptsOrigin(originHeader: string | undefined): boolean {
    // A missing Origin means a non-browser client (curl, the Vigolium CLI).
    if (!originHeader || !originHeader.trim()) return true;
    let url: URL;
    try {
      url = new URL(originHeader.trim());
    } catch {
      return false;
    }
    if (url.protocol !== "http:") return false;
    if (!url.hostname || url.username || url.password) return false;
    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) return false;
    const port = url.port ? Number(url.port) : 80;
    return this.acceptsHost(`${url.hostname}:${port}`);
  }

  displayUrl(): string {
    const host = this.#listen.host.includes(":") ? `[${this.#listen.host}]` : this.#listen.host;
    return `http://${host}:${this.#listen.port}`;
  }
}
