import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER_RULES, type FilterRule } from "shared";
import { evaluate, type FilterTarget } from "./filter";

function target(overrides: Partial<FilterTarget> = {}): FilterTarget {
  return {
    method: "GET",
    url: "https://example.com/api/users",
    path: "/api/users",
    query: "",
    host: "example.com",
    hasBody: false,
    hasCookies: false,
    statusCode: 200,
    contentType: "application/json",
    inScope: true,
    ...overrides,
  };
}

function rule(overrides: Partial<FilterRule>): FilterRule {
  return {
    enabled: true,
    operator: null,
    matchType: "URL",
    relationship: "MATCHES",
    condition: "",
    ...overrides,
  };
}

describe("evaluate", () => {
  it("passes everything when no rule is enabled", () => {
    expect(evaluate([], target())).toBe(true);
    expect(evaluate([rule({ enabled: false, condition: "nope" })], target())).toBe(true);
  });

  it("combines rules left to right without precedence", () => {
    const rules = [
      rule({ matchType: "HTTP_METHOD", relationship: "EQUALS", condition: "GET" }),
      rule({ operator: "AND", matchType: "STATUS_CODE", relationship: "EQUALS", condition: "200" }),
    ];
    expect(evaluate(rules, target())).toBe(true);
    expect(evaluate(rules, target({ statusCode: 404 }))).toBe(false);
  });

  it("treats OR as a plain left-to-right alternative", () => {
    const rules = [
      rule({ matchType: "HTTP_METHOD", relationship: "EQUALS", condition: "POST" }),
      rule({ operator: "OR", matchType: "HTTP_METHOD", relationship: "EQUALS", condition: "GET" }),
    ];
    expect(evaluate(rules, target())).toBe(true);
  });
});

describe("regex relationships", () => {
  // Java's Matcher.matches() anchors the whole value; the shipped default rules
  // depend on this, so a partial match must not count.
  it("anchors MATCHES to the full value", () => {
    const rules = [rule({ matchType: "HOST", relationship: "MATCHES", condition: "example" })];
    expect(evaluate(rules, target({ host: "example" }))).toBe(true);
    expect(evaluate(rules, target({ host: "example.com" }))).toBe(false);
  });

  it("uses a substring search for Content-Type only", () => {
    const rules = [
      rule({ matchType: "CONTENT_TYPE", relationship: "MATCHES", condition: "application/json" }),
    ];
    expect(evaluate(rules, target({ contentType: "application/json; charset=utf-8" }))).toBe(true);
  });

  it("does not match an invalid regex instead of throwing", () => {
    const rules = [rule({ matchType: "HOST", relationship: "MATCHES", condition: "([" })];
    expect(evaluate(rules, target())).toBe(false);
  });
});

describe("default rules", () => {
  it("keeps an API request", () => {
    expect(evaluate(DEFAULT_FILTER_RULES, target())).toBe(true);
  });

  it.each(["css", "js", "png", "woff2", "mp4"])("drops .%s assets", (extension) => {
    const path = `/assets/app.${extension}`;
    expect(evaluate(DEFAULT_FILTER_RULES, target({ path }))).toBe(false);
  });

  it.each(["OPTIONS", "HEAD"])("drops %s requests", (method) => {
    expect(evaluate(DEFAULT_FILTER_RULES, target({ method }))).toBe(false);
  });

  it("keeps an extensionless path", () => {
    expect(evaluate(DEFAULT_FILTER_RULES, target({ path: "/api/v1/users" }))).toBe(true);
  });

  it("ignores a dot that belongs to a directory segment", () => {
    expect(evaluate(DEFAULT_FILTER_RULES, target({ path: "/v1.0/users" }))).toBe(true);
  });
});

describe("scope and shape relationships", () => {
  it("reads scope from the target", () => {
    const rules = [rule({ matchType: "URL", relationship: "IS_IN_TARGET_SCOPE" })];
    expect(evaluate(rules, target({ inScope: true }))).toBe(true);
    expect(evaluate(rules, target({ inScope: false }))).toBe(false);
  });

  it("counts query, body or cookies as parameters", () => {
    const rules = [rule({ matchType: "REQUEST", relationship: "HAS_PARAMETERS" })];
    expect(evaluate(rules, target())).toBe(false);
    expect(evaluate(rules, target({ query: "a=1" }))).toBe(true);
    expect(evaluate(rules, target({ hasBody: true }))).toBe(true);
    expect(evaluate(rules, target({ hasCookies: true }))).toBe(true);
  });

  it("treats a missing response as not-matching for negative relationships", () => {
    const negative = [
      rule({ matchType: "STATUS_CODE", relationship: "NOT_EQUALS", condition: "404" }),
    ];
    expect(evaluate(negative, target({ statusCode: undefined }))).toBe(true);

    const positive = [rule({ matchType: "STATUS_CODE", relationship: "EQUALS", condition: "200" })];
    expect(evaluate(positive, target({ statusCode: undefined }))).toBe(false);
  });
});
