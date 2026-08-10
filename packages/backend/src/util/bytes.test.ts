import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { decodeBase64Strict, fromBase64, sha256Hex, toBase64, toLatin1 } from "./bytes";
import { parseRequestLine, parseStatusCode, parseTarget, requireAbsoluteHttpUrl } from "./rawhttp";

/** Fixture builder - production code never needs string→UTF-8 bytes. */
const utf8 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "utf-8"));

const RAW_REQUEST = "GET /imported?a=1 HTTP/1.1\r\nHost: example.com\r\nAccept: */*\r\n\r\n";

describe("base64", () => {
  it("round-trips binary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });

  it("matches the fixture the Vigolium docs use", () => {
    const encoded = toBase64(utf8(RAW_REQUEST));
    expect(toLatin1(fromBase64(encoded))).toBe(RAW_REQUEST);
  });

  // Buffer.from(..., "base64") silently drops invalid characters, which would
  // turn a corrupted body into plausible-but-wrong bytes.
  it("rejects malformed base64 instead of silently repairing it", () => {
    expect(() => decodeBase64Strict("!!!", "http_request_base64")).toThrow(/not valid base64/);
    expect(() => decodeBase64Strict("QQ", "http_request_base64")).toThrow(/not valid base64/);
    expect(() => decodeBase64Strict("QUJD", "http_request_base64")).not.toThrow();
  });
});

describe("sha256Hex", () => {
  it("produces the standard digest for an empty input", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is stable for the same bytes", () => {
    const bytes = utf8(RAW_REQUEST);
    expect(sha256Hex(bytes)).toBe(sha256Hex(bytes));
    expect(sha256Hex(bytes)).toHaveLength(64);
  });
});

describe("parseRequestLine", () => {
  it("splits method, path and query", () => {
    const parsed = parseRequestLine(utf8(RAW_REQUEST));
    expect(parsed).toEqual({ method: "GET", path: "/imported", query: "a=1" });
  });

  it("handles a bare path with no query", () => {
    const parsed = parseRequestLine(utf8("POST /submit HTTP/1.1\r\n\r\n"));
    expect(parsed).toEqual({ method: "POST", path: "/submit", query: "" });
  });

  // A deliberately malformed request still has to yield usable metadata,
  // because the raw bytes remain authoritative and must go on the wire intact.
  it("falls back to sane values for a malformed line", () => {
    expect(parseRequestLine(utf8(""))).toEqual({
      method: "GET",
      path: "/",
      query: "",
    });
  });
});

describe("parseStatusCode", () => {
  it("reads the status from a response head", () => {
    expect(parseStatusCode(utf8("HTTP/1.1 200 OK\r\n\r\n"))).toBe(200);
    expect(parseStatusCode(utf8("HTTP/2 404 Not Found\r\n\r\n"))).toBe(404);
  });

  it("returns 0 when there is no status line", () => {
    expect(parseStatusCode(utf8("garbage"))).toBe(0);
  });
});

describe("parseTarget", () => {
  it("derives host, port and TLS, defaulting the port by scheme", () => {
    expect(parseTarget("https://example.com/x")).toEqual({
      host: "example.com",
      port: 443,
      isTls: true,
    });
    expect(parseTarget("http://example.com/x")).toEqual({
      host: "example.com",
      port: 80,
      isTls: false,
    });
    expect(parseTarget("https://example.com:8443/x").port).toBe(8443);
  });
});

describe("requireAbsoluteHttpUrl", () => {
  it("accepts absolute http and https URLs", () => {
    expect(requireAbsoluteHttpUrl("https://example.com/a")).toBe("https://example.com/a");
  });

  it("rejects relative and non-http URLs", () => {
    expect(() => requireAbsoluteHttpUrl("/relative")).toThrow(/absolute http/);
    expect(() => requireAbsoluteHttpUrl("file:///etc/passwd")).toThrow(/absolute http/);
    expect(() => requireAbsoluteHttpUrl("")).toThrow(/absolute http/);
  });
});
