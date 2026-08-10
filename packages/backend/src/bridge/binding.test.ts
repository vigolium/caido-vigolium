import { describe, expect, it } from "vitest";
import { BridgeBinding, parseListenUrl } from "./binding";

describe("parseListenUrl", () => {
  it("accepts loopback addresses and localhost", () => {
    expect(parseListenUrl("http://127.0.0.1:9009")).toMatchObject({
      host: "127.0.0.1",
      port: 9009,
      configuredHost: "127.0.0.1",
    });
    expect(parseListenUrl("http://localhost:9009")).toMatchObject({
      host: "127.0.0.1",
      configuredHost: "localhost",
    });
    expect(parseListenUrl("http://127.5.5.5:9009").host).toBe("127.5.5.5");
    expect(parseListenUrl("http://[::1]:9009").host).toBe("::1");
  });

  it("refuses non-loopback binds", () => {
    expect(() => parseListenUrl("http://0.0.0.0:9009")).toThrow(/loopback/);
    expect(() => parseListenUrl("http://192.168.1.5:9009")).toThrow(/loopback/);
    // A hostname is refused rather than resolved, so DNS can never point the
    // listener off-host.
    expect(() => parseListenUrl("http://evil.example.com:9009")).toThrow(/loopback/);
  });

  it("requires http, a port, and no path", () => {
    expect(() => parseListenUrl("https://127.0.0.1:9009")).toThrow(/http:\/\//);
    expect(() => parseListenUrl("http://127.0.0.1")).toThrow(/host and port/);
    expect(() => parseListenUrl("http://127.0.0.1:9009/bridge")).toThrow(/path/);
    expect(() => parseListenUrl("")).toThrow();
  });
});

describe("BridgeBinding.acceptsHost", () => {
  const binding = new BridgeBinding(parseListenUrl("http://127.0.0.1:9009"));

  it("accepts the configured authority", () => {
    expect(binding.acceptsHost("127.0.0.1:9009")).toBe(true);
  });

  it("rejects a mismatched host or port", () => {
    expect(binding.acceptsHost("evil.example.com:9009")).toBe(false);
    expect(binding.acceptsHost("127.0.0.1:9010")).toBe(false);
    // Port defaults to 80 when absent, which never matches a 9009 listener.
    expect(binding.acceptsHost("127.0.0.1")).toBe(false);
    expect(binding.acceptsHost(undefined)).toBe(false);
    expect(binding.acceptsHost("")).toBe(false);
  });

  it("rejects smuggling-flavoured authorities", () => {
    expect(binding.acceptsHost("127.0.0.1:9009, evil.com")).toBe(false);
    expect(binding.acceptsHost("user@127.0.0.1:9009")).toBe(false);
    expect(binding.acceptsHost("127.0.0.1:9009/path")).toBe(false);
  });

  it("accepts localhost only when it was the configured host", () => {
    expect(binding.acceptsHost("localhost:9009")).toBe(false);
    const named = new BridgeBinding(parseListenUrl("http://localhost:9009"));
    expect(named.acceptsHost("localhost:9009")).toBe(true);
    expect(named.acceptsHost("127.0.0.1:9009")).toBe(true);
  });
});

describe("BridgeBinding.acceptsOrigin", () => {
  const binding = new BridgeBinding(parseListenUrl("http://127.0.0.1:9009"));

  it("allows a missing Origin, which is what non-browser clients send", () => {
    expect(binding.acceptsOrigin(undefined)).toBe(true);
    expect(binding.acceptsOrigin("")).toBe(true);
  });

  it("allows only its own origin", () => {
    expect(binding.acceptsOrigin("http://127.0.0.1:9009")).toBe(true);
    expect(binding.acceptsOrigin("http://evil.example.com")).toBe(false);
    expect(binding.acceptsOrigin("https://127.0.0.1:9009")).toBe(false);
    expect(binding.acceptsOrigin("null")).toBe(false);
    expect(binding.acceptsOrigin("http://127.0.0.1:9009/path")).toBe(false);
  });
});
