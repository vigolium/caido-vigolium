import { describe, expect, it } from "vitest";
import { fromUtf8 } from "./bytes";
import { deriveRequestUrl, parseHostHeader } from "./rawhttp";

const raw = (...lines: string[]): Uint8Array => fromUtf8(lines.join("\r\n"));

describe("parseHostHeader", () => {
  it("reads the host regardless of casing or padding", () => {
    expect(parseHostHeader(raw("GET / HTTP/1.1", "HOST:   example.com  ", "", ""))).toBe(
      "example.com",
    );
  });

  it("keeps an explicit port", () => {
    expect(parseHostHeader(raw("GET / HTTP/1.1", "Host: example.com:8443", "", ""))).toBe(
      "example.com:8443",
    );
  });

  it("ignores a host that only appears in the body", () => {
    expect(parseHostHeader(raw("POST / HTTP/1.1", "", "Host: evil.test"))).toBe("");
  });

  it("returns empty when there is no host header", () => {
    expect(parseHostHeader(raw("GET / HTTP/1.1", "Accept: */*", "", ""))).toBe("");
  });
});

describe("deriveRequestUrl", () => {
  it("combines the host header with the request target", () => {
    const bytes = raw("POST /api/soap/UserService HTTP/1.1", "Host: example.com", "", "");
    expect(deriveRequestUrl(bytes, "https://example.com/api/soap/UserService")).toBe(
      "https://example.com/api/soap/UserService",
    );
  });

  it("keeps the query string", () => {
    const bytes = raw("GET /search?q=1&x=2 HTTP/1.1", "Host: example.com", "", "");
    expect(deriveRequestUrl(bytes, "")).toBe("https://example.com/search?q=1&x=2");
  });

  it("takes the scheme from the hint", () => {
    const bytes = raw("GET /a HTTP/1.1", "Host: example.com", "", "");
    expect(deriveRequestUrl(bytes, "http://example.com/a")).toBe("http://example.com/a");
  });

  it("lets an explicit default port outrank the hint", () => {
    const bytes = raw("GET /a HTTP/1.1", "Host: example.com:80", "", "");
    expect(deriveRequestUrl(bytes, "https://elsewhere.test/a")).toBe("http://example.com:80/a");
  });

  it("defaults to https when nothing says otherwise", () => {
    // An agent finding's `matchedAt` is a source path, not a URL.
    const bytes = raw("GET /a HTTP/1.1", "Host: example.com", "", "");
    expect(deriveRequestUrl(bytes, "/opt/repos/shop-api/app/routes/orders.py:45")).toBe(
      "https://example.com/a",
    );
  });

  it("prefers an absolute request target over both", () => {
    const bytes = raw("GET http://origin.test/a HTTP/1.1", "Host: proxy.test", "", "");
    expect(deriveRequestUrl(bytes, "https://hint.test/a")).toBe("http://origin.test/a");
  });

  it("falls back to the hint's origin when there is no host header", () => {
    const bytes = raw("GET /a?b=1 HTTP/1.1", "Accept: */*", "", "");
    expect(deriveRequestUrl(bytes, "https://example.com:8443/whatever")).toBe(
      "https://example.com:8443/a?b=1",
    );
  });

  it("refuses when neither the message nor the hint names a target", () => {
    const bytes = raw("GET /a HTTP/1.1", "Accept: */*", "", "");
    expect(() => deriveRequestUrl(bytes, "")).toThrow(/no Host header/);
  });
});
