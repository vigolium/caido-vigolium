import { describe, expect, it } from "vitest";
import { buildHttpqlPrefilter, hostMatches, parseSearchCriteria } from "./search";

describe("parseSearchCriteria", () => {
  it("defaults to the sitemap location and a 50-row page", () => {
    const criteria = parseSearchCriteria({}, false);
    expect(criteria.location).toBe("sitemap");
    expect(criteria.limit).toBe(50);
    expect(criteria.offset).toBe(0);
    expect(criteria.sortAscending).toBe(false);
  });

  it("keeps proxy_history when asked for it", () => {
    expect(parseSearchCriteria({ location: "proxy_history" }, false).location).toBe(
      "proxy_history",
    );
    expect(parseSearchCriteria({ location: "nonsense" }, false).location).toBe("sitemap");
  });

  it("folds the legacy single-term aliases into search_terms", () => {
    const criteria = parseSearchCriteria(
      {
        search_terms: ["alpha"],
        text: "beta",
        header: "gamma",
        body: "delta",
      },
      false,
    );
    expect(criteria.searchTerms).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  it("folds exclude aliases too", () => {
    const criteria = parseSearchCriteria(
      { exclude_terms: ["a"], exclude_header: "b", exclude_body: "c" },
      false,
    );
    expect(criteria.excludeTerms).toEqual(["a", "b", "c"]);
  });

  it("clamps limit and offset", () => {
    expect(parseSearchCriteria({ limit: 99999 }, false).limit).toBe(5000);
    expect(parseSearchCriteria({ limit: -5 }, false).limit).toBe(0);
    expect(parseSearchCriteria({ offset: -5 }, false).offset).toBe(0);
  });

  it("lets the bridge setting force in-scope-only", () => {
    expect(parseSearchCriteria({}, true).inScopeOnly).toBe(true);
    expect(parseSearchCriteria({ in_scope_only: true }, false).inScopeOnly).toBe(true);
    expect(parseSearchCriteria({}, false).inScopeOnly).toBe(false);
  });

  it("uppercases methods and parses timestamps", () => {
    const criteria = parseSearchCriteria(
      { methods: ["get", "Post"], from: "2026-01-01T00:00:00Z" },
      false,
    );
    expect([...criteria.methods]).toEqual(["GET", "POST"]);
    expect(criteria.fromTime).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(parseSearchCriteria({ from: "not-a-date" }, false).fromTime).toBeUndefined();
  });
});

describe("hostMatches", () => {
  it("matches exactly when there is no wildcard", () => {
    expect(hostMatches("api.example.com", "api.example.com")).toBe(true);
    expect(hostMatches("api.example.com", "example.com")).toBe(false);
  });

  it("treats an empty pattern as match-all", () => {
    expect(hostMatches("api.example.com", "")).toBe(true);
    expect(hostMatches("api.example.com", "   ")).toBe(true);
  });

  it("supports wildcards and escapes regex metacharacters", () => {
    expect(hostMatches("api.example.com", "*.example.com")).toBe(true);
    expect(hostMatches("api.example.com", "api.*")).toBe(true);
    // The dots are literal, so this must not match via regex "any character".
    expect(hostMatches("apixexamplexcom", "api.example.com")).toBe(false);
  });

  it("normalises case and a trailing root dot", () => {
    expect(hostMatches("API.Example.COM.", "api.example.com")).toBe(true);
  });
});

describe("buildHttpqlPrefilter", () => {
  it("restricts proxy_history to intercepted traffic", () => {
    const criteria = parseSearchCriteria({ location: "proxy_history" }, false);
    expect(buildHttpqlPrefilter(criteria)).toContain(`source:"intercept"`);
  });

  // Verified against a live Caido 0.57 instance: the colon form parses, the
  // space form documented elsewhere is rejected as "Invalid filter".
  it("emits only unambiguous structured clauses, in colon syntax", () => {
    const criteria = parseSearchCriteria(
      { host: "api.example.com", methods: ["GET"], status: [200] },
      false,
    );
    const filter = buildHttpqlPrefilter(criteria);
    expect(filter).toContain(`req.host.eq:"api.example.com"`);
    expect(filter).toContain(`req.method.eq:"GET"`);
    expect(filter).toContain("resp.code.eq:200");
    expect(filter).toContain(" and ");
    expect(filter).not.toContain(" eq ");
  });

  it("skips clauses it cannot express exactly", () => {
    // A wildcard host and multi-valued sets are left to the JS predicates, so
    // the prefilter can only ever narrow the scan, never change the result.
    const criteria = parseSearchCriteria(
      { host: "*.example.com", methods: ["GET", "POST"], status: [200, 302] },
      false,
    );
    expect(buildHttpqlPrefilter(criteria)).toBe("");
  });
});
