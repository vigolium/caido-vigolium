import { describe, expect, it } from "vitest";
import {
  collectTargets,
  pageSelectionIds,
  resolveDispatchTargets,
  targetUrl,
  type CommandContext,
  type Selection,
  type TargetSources,
} from "./dispatch-target";

/**
 * These cover the logic behind the "hotkey does nothing" class of bug: a
 * shortcut arrives with no invocation target, and every page describes its
 * selection differently.
 */

function sources(options: {
  page?: unknown;
  sessions?: { id: string; entryIds: string[] }[];
  entries?: Record<string, { requestId?: string }>;
}): TargetSources {
  return {
    window: { getContext: () => ({ page: options.page }) },
    replay: {
      getSessions: () => options.sessions ?? [],
      getEntry: (id: string) => options.entries?.[id],
    },
  } as unknown as TargetSources;
}

const selected = (main: string, ...secondary: string[]): Selection => ({
  kind: "Selected",
  main,
  secondary,
});

describe("collectTargets", () => {
  it("takes every id from a multi-row selection, in order", () => {
    const context: CommandContext = {
      type: "RequestRowContext",
      requests: [{ id: "3" }, { id: "1" }, { id: "2" }],
    };
    expect(collectTargets(context).ids).toEqual(["3", "1", "2"]);
  });

  // A RequestDraft is an unsaved editor buffer with no id at all, so it can only
  // travel as bytes - treating it as id-bearing is what silently sent nothing.
  it("sends an editor draft as raw bytes rather than an id", () => {
    const context: CommandContext = {
      type: "RequestContext",
      request: { host: "example.com", port: 443, isTls: true, path: "/a", raw: "GET /a HTTP/1.1" },
      response: { raw: "HTTP/1.1 200 OK" },
    };
    const target = collectTargets(context);
    expect(target.ids).toEqual([]);
    expect(target.raw).toEqual([
      { url: "https://example.com/a", request: "GET /a HTTP/1.1", response: "HTTP/1.1 200 OK" },
    ]);
  });

  it("prefers raw bytes over the id when the editor has both", () => {
    const target = collectTargets({
      type: "RequestContext",
      request: { id: "7", host: "example.com", path: "/", raw: "GET / HTTP/1.1" },
    });
    expect(target.ids).toEqual([]);
    expect(target.raw).toHaveLength(1);
  });

  it("falls back to the id when there are no raw bytes", () => {
    expect(collectTargets({ type: "RequestContext", request: { id: "7" } }).ids).toEqual(["7"]);
  });

  it("does not duplicate an id already present in the row list", () => {
    const target = collectTargets({
      type: "RequestRowContext",
      requests: [{ id: "7" }],
      request: { id: "7" },
    });
    expect(target.ids).toEqual(["7"]);
  });

  it("yields nothing for a bare shortcut context", () => {
    expect(collectTargets({ type: "BaseContext" })).toEqual({ ids: [], raw: [] });
    expect(collectTargets(undefined)).toEqual({ ids: [], raw: [] });
  });
});

describe("targetUrl", () => {
  it("omits the port when it is the scheme default", () => {
    expect(targetUrl({ host: "example.com", port: 443, isTls: true, path: "/a" })).toBe(
      "https://example.com/a",
    );
    expect(targetUrl({ host: "example.com", port: 80, path: "/a" })).toBe("http://example.com/a");
  });

  it("keeps a non-default port and the query", () => {
    expect(
      targetUrl({ host: "example.com", port: 8443, isTls: true, path: "/a", query: "b=1" }),
    ).toBe("https://example.com:8443/a?b=1");
  });
});

describe("pageSelectionIds", () => {
  it("reads a multi-row HTTP history selection", () => {
    const sdk = sources({
      page: { kind: "HTTPHistory", selection: selected("406", "405", "404") },
    });
    expect(pageSelectionIds(sdk)).toEqual(["406", "405", "404"]);
  });

  // Sitemap has two selections; only the request one can be dispatched.
  it("prefers the Sitemap's request selection over its entry selection", () => {
    const sdk = sources({
      page: {
        kind: "Sitemap",
        entrySelection: selected("node-1"),
        requestSelection: selected("9"),
      },
    });
    expect(pageSelectionIds(sdk)).toEqual(["9"]);
  });

  // Replay selects sessions, not requests - handing these straight to
  // requests.get() would find nothing.
  it("resolves Replay sessions to the request behind their latest entry", () => {
    const sdk = sources({
      page: { kind: "Replay", selection: selected("s1") },
      sessions: [{ id: "s1", entryIds: ["e1", "e2"] }],
      entries: { e1: { requestId: "r1" }, e2: { requestId: "r2" } },
    });
    expect(pageSelectionIds(sdk)).toEqual(["r2"]);
  });

  it("skips a Replay session that has never been sent", () => {
    const sdk = sources({
      page: { kind: "Replay", selection: selected("s1") },
      sessions: [{ id: "s1", entryIds: [] }],
    });
    expect(pageSelectionIds(sdk)).toEqual([]);
  });

  it("returns nothing when the page has no selection", () => {
    expect(
      pageSelectionIds(sources({ page: { kind: "HTTPHistory", selection: { kind: "Empty" } } })),
    ).toEqual([]);
    expect(pageSelectionIds(sources({}))).toEqual([]);
  });
});

describe("resolveDispatchTargets", () => {
  const sdk = sources({ page: { kind: "HTTPHistory", selection: selected("1", "2") } });

  // The whole point: a shortcut carries no target, so the page selection is the
  // only thing that says what the user meant.
  it("falls back to the page selection for a bare shortcut context", () => {
    expect(resolveDispatchTargets(sdk, { type: "BaseContext" }).ids).toEqual(["1", "2"]);
  });

  it("uses the invocation's own targets when it has them", () => {
    const context: CommandContext = { type: "RequestRowContext", requests: [{ id: "99" }] };
    expect(resolveDispatchTargets(sdk, context).ids).toEqual(["99"]);
  });
});
