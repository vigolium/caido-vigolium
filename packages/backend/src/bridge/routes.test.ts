import { describe, expect, it, vi } from "vitest";
import {
  BRIDGE_IMPLEMENTATION,
  BRIDGE_SERVICE,
  INGEST_SOURCE,
  INGEST_SOURCE_HEADER,
  MAX_REPEATER_TABS_PER_MINUTE,
} from "shared";
import { RefStore } from "./refs";
import {
  BridgeError,
  RepeaterRateLimiter,
  type RouteContext,
  bodyLimitFor,
  health,
  inspect,
} from "./routes";

/**
 * Wire-contract tests.
 *
 * The Vigolium Go client decodes these responses by exact field name
 * (`pkg/burpbridge/client.go`), so a rename here breaks `vigolium traffic`
 * silently rather than loudly. These pin the names.
 */

function context(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdk: {} as any,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as RouteContext["log"],
    refs: new RefStore(),
    limiter: new RepeaterRateLimiter(),
    inScopeOnly: () => false,
    project: () => ({ id: null, name: null }),
    ...overrides,
  };
}

describe("GET /health", () => {
  it("reports the fields the Vigolium client reads", () => {
    const body = health(context());
    expect(body).toMatchObject({
      status: "ok",
      service: "vigolium-burp-bridge",
      implementation: "vigolium-caido-bridge",
      loopback_only: true,
      authentication: "none",
      in_scope_only: false,
      send_respects_in_scope_only: false,
      repeater_tabs_per_minute: MAX_REPEATER_TABS_PER_MINUTE,
    });
    expect(body.capabilities).toEqual([
      "search_burp_items",
      "inspect_burp_item",
      "add_sitemap_item",
      "send_to_repeater",
      "send_request",
      "add_organizer_item",
    ]);
  });

  it("mirrors the in-scope setting into both scope fields", () => {
    const body = health(context({ inScopeOnly: () => true }));
    expect(body.in_scope_only).toBe(true);
    expect(body.send_respects_in_scope_only).toBe(true);
  });

  it("names the active project, which Burp had no equivalent of", () => {
    const body = health(context({ project: () => ({ id: "p1", name: "acme" }) }));
    expect(body).toMatchObject({ project_id: "p1", project_name: "acme" });
  });
});

/**
 * Vigolium maps these strings, not fuzzy-matches them: `implementationSources`
 * in `pkg/burpbridge/client.go` is a closed table, and anything it does not
 * recognise is labelled `burp`. So a typo here does not fail loudly - it makes
 * every Caido record show up in the traffic Source column as Burp.
 */
describe("vendor identity", () => {
  it("reports the shared protocol name and a distinct implementation", () => {
    // Both integrations answer the same `service` on purpose: tooling sniffs it
    // to recognise the protocol, so it must NOT become Caido-specific.
    expect(BRIDGE_SERVICE).toBe("vigolium-burp-bridge");
    expect(BRIDGE_IMPLEMENTATION).toBe("vigolium-caido-bridge");
    expect(BRIDGE_IMPLEMENTATION).not.toBe(BRIDGE_SERVICE);
  });

  it("declares the same label on the push path as the bridge path", () => {
    // One `--source caido` filter has to cover traffic that arrived either by
    // Vigolium pulling over the bridge or by the plugin pushing to the server.
    expect(INGEST_SOURCE).toBe("caido");
    expect(INGEST_SOURCE_HEADER).toBe("X-Vigolium-Source");
  });
});

describe("body limits", () => {
  it("gives write routes the large cap and read routes the small one", () => {
    expect(bodyLimitFor("/api/burp-bridge/sitemap")).toBe(24 * 1024 * 1024);
    expect(bodyLimitFor("/api/burp-bridge/send")).toBe(24 * 1024 * 1024);
    expect(bodyLimitFor("/api/burp-bridge/organizer")).toBe(24 * 1024 * 1024);
    // Repeater opens a visible tab per call, so it is capped far lower.
    expect(bodyLimitFor("/api/burp-bridge/repeater")).toBe(2 * 1024 * 1024);
    expect(bodyLimitFor("/api/burp-bridge/search")).toBe(64 * 1024);
    expect(bodyLimitFor("/api/burp-bridge/inspect")).toBe(64 * 1024);
  });
});

describe("ref handling", () => {
  it("rejects a missing ref with a 400", async () => {
    await expect(inspect(context(), {})).rejects.toMatchObject({
      status: 400,
      message: "ref is required",
    });
  });

  it("tells the client to search again when a ref is unknown", async () => {
    // The Go client keys its retry on this, so the message matters.
    await expect(inspect(context(), { ref: "nope" })).rejects.toThrow(/search again/);
  });

  it("hands out unique refs and forgets them on clear", () => {
    const refs = new RefStore();
    const a = refs.remember({ requestId: "1", url: "https://example.com/a" });
    const b = refs.remember({ requestId: "2", url: "https://example.com/b" });
    expect(a).not.toBe(b);
    expect(refs.require(a).requestId).toBe("1");
    expect(refs.size()).toBe(2);

    refs.clear();
    expect(refs.size()).toBe(0);
    expect(() => refs.require(a)).toThrow(/search again/);
  });
});

describe("RepeaterRateLimiter", () => {
  it("allows a full minute's worth of sessions then rejects with 429", () => {
    const limiter = new RepeaterRateLimiter();
    for (let i = 0; i < MAX_REPEATER_TABS_PER_MINUTE; i++) {
      expect(() => limiter.reserve()).not.toThrow();
    }
    try {
      limiter.reserve();
      throw new Error("expected the limiter to reject");
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeError);
      expect((e as BridgeError).status).toBe(429);
    }
  });

  it("frees slots as the sliding window advances", () => {
    vi.useFakeTimers();
    try {
      const limiter = new RepeaterRateLimiter();
      for (let i = 0; i < MAX_REPEATER_TABS_PER_MINUTE; i++) limiter.reserve();
      expect(() => limiter.reserve()).toThrow();

      vi.advanceTimersByTime(61_000);
      expect(() => limiter.reserve()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears on listener shutdown", () => {
    const limiter = new RepeaterRateLimiter();
    for (let i = 0; i < MAX_REPEATER_TABS_PER_MINUTE; i++) limiter.reserve();
    limiter.clear();
    expect(() => limiter.reserve()).not.toThrow();
  });
});
