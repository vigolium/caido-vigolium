import { Buffer } from "buffer";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeBinding, parseListenUrl } from "./binding";
import { HttpListener, type BridgeRequest, type BridgeResponse } from "./http";

/**
 * Socket-level tests for the hand-rolled HTTP server.
 *
 * The runtime gives us `net` but no `http`, so the request parser is ours and
 * sits at an unauthenticated trust boundary. These drive it over a real TCP
 * connection rather than calling the parser directly, so framing bugs - split
 * chunks, oversized bodies, header/body boundaries - surface here rather than
 * inside Caido.
 */

const PORT = 19_009;
const ADDRESS = parseListenUrl(`http://127.0.0.1:${PORT}`);

let listener: HttpListener | undefined;

afterEach(() => {
  listener?.close();
  listener = undefined;
});

type RawResponse = { status: number; headers: Map<string, string>; body: string };

async function start(
  handler: (request: BridgeRequest) => Promise<BridgeResponse>,
  bodyLimit = 64 * 1024,
): Promise<void> {
  listener = new HttpListener(
    handler,
    () => bodyLimit,
    () => {},
  );
  await listener.listen(ADDRESS.host, ADDRESS.port);
}

/** Sends raw bytes and reads the whole reply, so framing is exercised end to end. */
function sendRaw(payload: string | Buffer, chunks?: string[]): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    void import("net").then(({ connect }) => {
      const socket = connect(PORT, "127.0.0.1", () => {
        if (chunks) {
          // Deliberately split so the parser must reassemble across events.
          let index = 0;
          const writeNext = () => {
            if (index >= chunks.length) return;
            socket.write(chunks[index]!);
            index++;
            setTimeout(writeNext, 5);
          };
          writeNext();
        } else {
          socket.write(payload);
        }
      });

      const parts: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => parts.push(chunk));
      socket.on("error", reject);
      socket.on("close", () => {
        const text = Buffer.concat(parts).toString("latin1");
        const split = text.indexOf("\r\n\r\n");
        const head = text.slice(0, split).split("\r\n");
        const statusLine = head.shift() ?? "";
        const headers = new Map<string, string>();
        for (const line of head) {
          const sep = line.indexOf(":");
          if (sep > 0)
            headers.set(line.slice(0, sep).trim().toLowerCase(), line.slice(sep + 1).trim());
        }
        resolve({
          status: Number(statusLine.split(" ")[1] ?? 0),
          headers,
          body: text.slice(split + 4),
        });
      });
    });
  });
}

function post(path: string, body: string, extraHeaders = ""): string {
  return (
    `POST ${path} HTTP/1.1\r\n` +
    `Host: 127.0.0.1:${PORT}\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    extraHeaders +
    `\r\n${body}`
  );
}

const echo = async (request: BridgeRequest): Promise<BridgeResponse> => ({
  status: 200,
  json: {
    method: request.method,
    path: request.path,
    body: Buffer.from(request.body).toString("utf-8"),
  },
});

describe("HttpListener", () => {
  it("serves a GET and sets hardening headers", async () => {
    await start(echo);
    const response = await sendRaw(`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n\r\n`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(JSON.parse(response.body)).toMatchObject({ method: "GET", path: "/health" });
  });

  it("reads a fixed-length POST body", async () => {
    await start(echo);
    const response = await sendRaw(post("/api/burp-bridge/search", '{"limit":10}'));
    expect(JSON.parse(response.body).body).toBe('{"limit":10}');
  });

  it("reassembles a request split across TCP segments", async () => {
    await start(echo);
    const body = '{"limit":10}';
    const response = await sendRaw("", [
      "POST /api/burp-bridge/search HTTP/1.1\r\n",
      `Host: 127.0.0.1:${PORT}\r\n`,
      // The header terminator itself is split, which is where a naive scan breaks.
      `Content-Length: ${body.length}\r\n\r`,
      "\n",
      body.slice(0, 4),
      body.slice(4),
    ]);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).body).toBe(body);
  });

  it("strips the query string from the routed path", async () => {
    await start(echo);
    const response = await sendRaw(
      `GET /health?verbose=1 HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n\r\n`,
    );
    expect(JSON.parse(response.body).path).toBe("/health");
  });

  it("requires content-length on POST", async () => {
    await start(echo);
    const response = await sendRaw(
      `POST /api/burp-bridge/search HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n\r\n`,
    );
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/content-length is required/);
  });

  it("rejects a body over the route's cap before reading it", async () => {
    await start(echo, 16);
    const response = await sendRaw(post("/api/burp-bridge/search", "x".repeat(64)));
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/exceeds/);
  });

  it("rejects a malformed request line", async () => {
    await start(echo);
    const response = await sendRaw("NOTHTTP\r\n\r\n");
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/malformed request line/);
  });

  it("keeps the first Host header when one is duplicated", async () => {
    // A smuggled second Host must not be able to override the real one.
    await start(async (request) => ({
      status: 200,
      json: { host: request.headers.get("host") },
    }));
    const response = await sendRaw(
      `GET /health HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nHost: evil.example.com\r\n\r\n`,
    );
    expect(JSON.parse(response.body).host).toBe(`127.0.0.1:${PORT}`);
  });

  it("surfaces a handler failure as a 500 without killing the listener", async () => {
    await start(async () => {
      throw new Error("boom");
    });
    const first = await sendRaw(`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n\r\n`);
    expect(first.status).toBe(500);
    expect(JSON.parse(first.body).error).toBe("boom");

    // Still serving afterwards.
    const second = await sendRaw(`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n\r\n`);
    expect(second.status).toBe(500);
  });

  it("refuses to start twice on the same port", async () => {
    await start(echo);
    const second = new HttpListener(
      echo,
      () => 1024,
      () => {},
    );
    await expect(second.listen(ADDRESS.host, ADDRESS.port)).rejects.toThrow();
    second.close();
  });
});

describe("Host/Origin gating over the wire", () => {
  const binding = new BridgeBinding(ADDRESS);

  async function startGated(): Promise<void> {
    await start(async (request) => {
      if (!binding.acceptsHost(request.headers.get("host"))) {
        return { status: 403, json: { error: "unexpected Host header" }, close: true };
      }
      if (!binding.acceptsOrigin(request.headers.get("origin"))) {
        return { status: 403, json: { error: "unexpected Origin header" }, close: true };
      }
      return { status: 200, json: { ok: true } };
    });
  }

  it("accepts the configured authority", async () => {
    await startGated();
    const response = await sendRaw(`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n\r\n`);
    expect(response.status).toBe(200);
  });

  it("rejects a rebound Host", async () => {
    await startGated();
    const response = await sendRaw(`GET /health HTTP/1.1\r\nHost: attacker.example.com\r\n\r\n`);
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toMatch(/Host/);
  });

  it("rejects a cross-site Origin", async () => {
    await startGated();
    const response = await sendRaw(
      `GET /health HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nOrigin: http://evil.example.com\r\n\r\n`,
    );
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toMatch(/Origin/);
  });
});
