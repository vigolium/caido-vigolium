import { Buffer } from "buffer";
import { createServer, type Server, type Socket } from "net";
import { errorMessage } from "shared";
import { humanBytes } from "../util/limits";

/**
 * A minimal HTTP/1.1 server over raw TCP.
 *
 * Caido's plugin runtime exposes `net` but no `http`, so the bridge speaks just
 * enough of the protocol to serve the listener: fixed-length request bodies,
 * fixed-length responses, and one request per connection. That is all the
 * Vigolium client ever sends, and a narrow parser is easier to reason about at
 * a security boundary than a general-purpose one.
 */

export type BridgeRequest = {
  method: string;
  path: string;
  headers: Map<string, string>;
  body: Uint8Array;
};

export type BridgeResponse = {
  status: number;
  json: unknown;
  /** Close the connection after replying - used for rejected requests. */
  close?: boolean;
};

export type Handler = (request: BridgeRequest) => Promise<BridgeResponse>;

/** Decides the body cap for a path before the body is read. */
export type BodyLimitResolver = (path: string) => number;

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  400: "Bad Request",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  413: "Payload Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

const MAX_HEADER_BYTES = 64 * 1024;
const HEADER_TERMINATOR_LENGTH = 4;
const SOCKET_TIMEOUT_MS = 30_000;

/**
 * Byte-scan for the CRLF CRLF that ends the header block.
 *
 * The runtime's Buffer only exposes `Uint8Array.indexOf`, which searches for a
 * single byte, so the multi-byte terminator is located manually. Scanning from
 * `start` avoids re-checking bytes already examined on earlier chunks.
 */
function indexOfHeaderEnd(buffer: Buffer, start: number): number {
  const from = Math.max(0, start - (HEADER_TERMINATOR_LENGTH - 1));
  for (let i = from; i + 3 < buffer.length; i++) {
    if (
      buffer[i] === 0x0d &&
      buffer[i + 1] === 0x0a &&
      buffer[i + 2] === 0x0d &&
      buffer[i + 3] === 0x0a
    ) {
      return i;
    }
  }
  return -1;
}

export class HttpListener {
  #server: Server | undefined;
  #handler: Handler;
  #bodyLimit: BodyLimitResolver;
  #onError: (message: string) => void;

  constructor(handler: Handler, bodyLimit: BodyLimitResolver, onError: (message: string) => void) {
    this.#handler = handler;
    this.#bodyLimit = bodyLimit;
    this.#onError = onError;
  }

  listen(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const server = createServer((socket) => this.#accept(socket));

      server.on("error", (e: Error) => {
        if (!settled) {
          settled = true;
          reject(e);
          return;
        }
        this.#onError(e.message);
      });

      server.listen(port, host, () => {
        settled = true;
        this.#server = server;
        resolve();
      });
    });
  }

  close(): void {
    const server = this.#server;
    this.#server = undefined;
    if (!server) return;
    try {
      server.close();
    } catch {
      // Already closed; nothing to unwind.
    }
  }

  #accept(socket: Socket): void {
    /**
     * Chunks are collected and joined once rather than concatenated on arrival:
     * write bodies run to 24 MiB, and re-copying the whole buffer per TCP chunk
     * makes reading one of them quadratic - gigabytes of memcpy per request.
     */
    const chunks: Buffer[] = [];
    let received = 0;
    let buffer = Buffer.alloc(0);
    let scanned = 0;
    let headerEnd = -1;
    let expectedBody = 0;
    let head: { method: string; path: string; headers: Map<string, string> } | undefined;
    let finished = false;

    // A client that opens a connection and never completes a request would
    // otherwise hold the socket open indefinitely.
    const timer = setTimeout(() => {
      finish({ status: 400, json: { error: "request timed out" }, close: true });
    }, SOCKET_TIMEOUT_MS);

    const finish = (response: BridgeResponse) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      writeResponse(socket, response);
    };

    socket.on("error", () => {
      finished = true;
      clearTimeout(timer);
    });

    const joined = () => (chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, received));

    socket.on("data", (chunk: Buffer) => {
      if (finished) return;
      chunks.push(chunk);
      received += chunk.length;

      if (headerEnd < 0) {
        // Joining while scanning is bounded by MAX_HEADER_BYTES, so it stays
        // cheap; the body is the part that must only ever be joined once.
        buffer = joined();
        headerEnd = indexOfHeaderEnd(buffer, scanned);
        scanned = buffer.length;
        if (headerEnd < 0) {
          if (received > MAX_HEADER_BYTES) {
            finish({ status: 400, json: { error: "request headers too large" }, close: true });
          }
          return;
        }

        const parsed = parseHead(buffer.toString("latin1", 0, headerEnd));
        if (!parsed) {
          finish({ status: 400, json: { error: "malformed request line" }, close: true });
          return;
        }
        head = parsed;

        const limit = this.#bodyLimit(parsed.path);
        const contentLength = parsed.headers.get("content-length");
        if (parsed.method === "POST") {
          if (contentLength === undefined) {
            finish({ status: 400, json: { error: "content-length is required" } });
            return;
          }
          const declared = Number(contentLength);
          if (!Number.isInteger(declared) || declared < 0) {
            finish({ status: 400, json: { error: "invalid content-length" } });
            return;
          }
          if (declared > limit) {
            finish({ status: 400, json: { error: `request exceeds ${humanBytes(limit)}` } });
            return;
          }
          expectedBody = declared;
        }
      }

      const bodyStart = headerEnd + HEADER_TERMINATOR_LENGTH;
      if (received - bodyStart < expectedBody) return;

      const complete = joined();
      const request: BridgeRequest = {
        method: head!.method,
        path: head!.path,
        headers: head!.headers,
        body: new Uint8Array(complete.subarray(bodyStart, bodyStart + expectedBody)),
      };

      this.#handler(request)
        .then(finish)
        .catch((e: unknown) => {
          const detail = errorMessage(e);
          this.#onError(`request failed: ${detail}`);
          finish({ status: 500, json: { error: detail } });
        });
    });
  }
}

function parseHead(
  text: string,
): { method: string; path: string; headers: Map<string, string> } | undefined {
  const lines = text.split("\r\n");
  const requestLine = lines.shift();
  if (!requestLine) return undefined;

  const parts = requestLine.split(" ");
  if (parts.length < 3) return undefined;
  const [method, target] = parts;
  if (!method || !target) return undefined;

  const headers = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    // First value wins, so a smuggled duplicate Host cannot override the real one.
    if (!headers.has(name)) headers.set(name, value);
  }

  const queryStart = target.indexOf("?");
  const path = queryStart >= 0 ? target.slice(0, queryStart) : target;
  return { method: method.toUpperCase(), path, headers };
}

function writeResponse(socket: Socket, response: BridgeResponse): void {
  const body = Buffer.from(JSON.stringify(response.json ?? {}), "utf-8");
  const statusText = STATUS_TEXT[response.status] ?? "Unknown";
  const head =
    `HTTP/1.1 ${response.status} ${statusText}\r\n` +
    "Content-Type: application/json; charset=utf-8\r\n" +
    `Content-Length: ${body.length}\r\n` +
    "Cache-Control: no-store\r\n" +
    "X-Content-Type-Options: nosniff\r\n" +
    "Connection: close\r\n\r\n";
  try {
    socket.write(Buffer.concat([Buffer.from(head, "latin1"), body]));
    socket.end();
  } catch {
    // Client hung up mid-reply; nothing useful to report.
  }
}
