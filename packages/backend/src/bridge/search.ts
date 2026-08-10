import type { Request, Response } from "caido:utils";
import { toLatin1 } from "../util/bytes";
import { pickInt, pickString, pickStringList, type Json } from "../util/json";
import { normalizeHost } from "./binding";

/**
 * Search criteria for the bridge's /search route.
 *
 * The semantics here are a deliberate, literal port of the Burp listener's
 * `SearchCriteria`: substring containment over raw messages, glob host match,
 * case-insensitive path containment. The Vigolium CLI relies on these exact
 * behaviours when it merges live rows with the database, so "improving" them
 * would silently change `vigolium traffic` output.
 */
export type SearchCriteria = {
  location: "proxy_history" | "sitemap";
  host: string;
  methods: Set<string>;
  path: string;
  statuses: Set<number>;
  mimeType: string;
  searchTerms: string[];
  excludeTerms: string[];
  fromTime: number | undefined;
  toTime: number | undefined;
  inScopeOnly: boolean;
  limit: number;
  offset: number;
  sortBy: string;
  sortAscending: boolean;
};

export function parseSearchCriteria(args: Json, bridgeInScopeOnly: boolean): SearchCriteria {
  const location = pickString(args, "location") === "proxy_history" ? "proxy_history" : "sitemap";

  const methods = new Set<string>();
  for (const method of terms(args, "methods")) methods.add(method.toUpperCase());

  const statuses = new Set<number>();
  if (Array.isArray(args.status)) {
    for (const entry of args.status) {
      const code = Number(entry);
      if (Number.isInteger(code)) statuses.add(code);
    }
  }

  // `text`, `header` and `body` are legacy single-term aliases that fold into
  // the same AND-ed term list as `search_terms`.
  const searchTerms = terms(args, "search_terms");
  pushIfPresent(searchTerms, pickString(args, "text"));
  pushIfPresent(searchTerms, pickString(args, "header"));
  pushIfPresent(searchTerms, pickString(args, "body"));

  const excludeTerms = terms(args, "exclude_terms");
  pushIfPresent(excludeTerms, pickString(args, "exclude_header"));
  pushIfPresent(excludeTerms, pickString(args, "exclude_body"));

  const rawLimit = pickInt(args, "limit", 50);
  const rawOffset = pickInt(args, "offset", 0);

  return {
    location,
    host: pickString(args, "host"),
    methods,
    path: pickString(args, "path"),
    statuses,
    mimeType: pickString(args, "mime_type"),
    searchTerms,
    excludeTerms,
    fromTime: parseTime(pickString(args, "from")),
    toTime: parseTime(pickString(args, "to")),
    inScopeOnly: bridgeInScopeOnly || args.in_scope_only === true,
    limit: Math.max(0, Math.min(rawLimit, 5000)),
    offset: Math.max(0, rawOffset),
    sortBy: pickString(args, "sort"),
    sortAscending: pickString(args, "order").toLowerCase() === "asc",
  };
}

export type Candidate = {
  request: Request;
  response: Response | undefined;
  createdAt: number;
  /**
   * Lowercased message text, decoded on the first term test and reused by the
   * rest. Left unset when the query carries no terms: decoding every scanned
   * message up front turned the whole traffic store into strings for queries
   * that never read them.
   */
  text?: { request: string; response: string };
};

/**
 * A `SearchCriteria` with its per-scan derivations already done.
 *
 * `matches` runs against up to `MAX_SCAN` candidates, so lowercasing terms,
 * stripping the path wildcards and compiling the host glob belong here - once
 * per search - rather than once per candidate.
 */
export type Matcher = {
  criteria: SearchCriteria;
  host: HostMatcher | undefined;
  path: string;
  mimeType: string;
  searchTerms: string[];
  excludeTerms: string[];
};

export function deriveMatcher(criteria: SearchCriteria): Matcher {
  return {
    criteria,
    host: compileHost(criteria.host),
    // Burp treated `*` as decoration around a substring rather than a real glob.
    path: criteria.path.replace(/\*/g, "").toLowerCase(),
    mimeType: criteria.mimeType.toLowerCase(),
    searchTerms: criteria.searchTerms.filter(Boolean).map((term) => term.toLowerCase()),
    excludeTerms: criteria.excludeTerms.filter(Boolean).map((term) => term.toLowerCase()),
  };
}

/**
 * Predicates run cheapest-first, which is also what keeps the text decode off
 * the path for every candidate a structural filter already rejected.
 */
export function matches(matcher: Matcher, candidate: Candidate, inScope: boolean): boolean {
  const { criteria } = matcher;
  if (criteria.inScopeOnly && !inScope) return false;

  if (criteria.fromTime !== undefined && candidate.createdAt < criteria.fromTime) return false;
  if (criteria.toTime !== undefined && candidate.createdAt > criteria.toTime) return false;

  if (matcher.host && !matcher.host(candidate.request.getHost())) return false;

  if (
    criteria.methods.size > 0 &&
    !criteria.methods.has(candidate.request.getMethod().toUpperCase())
  ) {
    return false;
  }

  if (matcher.path && !candidate.request.getPath().toLowerCase().includes(matcher.path)) {
    return false;
  }

  if (criteria.statuses.size > 0) {
    if (!candidate.response || !criteria.statuses.has(candidate.response.getCode())) return false;
  }

  if (matcher.mimeType) {
    if (!candidate.response) return false;
    const contentType = headerValue(candidate.response, "content-type").toLowerCase();
    if (!contentType.includes(matcher.mimeType)) return false;
  }

  for (const term of matcher.searchTerms) {
    if (!contains(candidate, term)) return false;
  }
  for (const term of matcher.excludeTerms) {
    if (contains(candidate, term)) return false;
  }
  return true;
}

/**
 * Request and response are searched separately, never concatenated: a term
 * spanning the join would otherwise match a message pair that contains it in
 * neither half.
 */
function contains(candidate: Candidate, needle: string): boolean {
  const text = decodeText(candidate);
  return text.request.includes(needle) || text.response.includes(needle);
}

function decodeText(candidate: Candidate): { request: string; response: string } {
  if (!candidate.text) {
    candidate.text = {
      request: toLatin1(candidate.request.getRaw().toBytes()).toLowerCase(),
      response: candidate.response
        ? toLatin1(candidate.response.getRaw().toBytes()).toLowerCase()
        : "",
    };
  }
  return candidate.text;
}

export function headerValue(message: Request | Response, name: string): string {
  // `getHeader` is already case-insensitive and defaults to raw:false, so the
  // object form this used to try first was the same call twice.
  const values = message.getHeader(name);
  return values?.[0] ?? "";
}

type HostMatcher = (host: string) => boolean;

const REGEX_METACHARACTERS = /[\\.[\]{}()+\-^$|?]/g;

/**
 * Compiles a host pattern once. `undefined` means "match everything", which is
 * what an empty pattern denotes.
 */
function compileHost(pattern: string): HostMatcher | undefined {
  const normalized = normalizeHost(pattern);
  if (!normalized) return undefined;
  if (!normalized.includes("*")) return (host) => normalizeHost(host) === normalized;

  const source = normalized
    .split("*")
    .map((part) => part.replace(REGEX_METACHARACTERS, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${source}$`);
  return (host) => regex.test(normalizeHost(host));
}

/** Single-shot host match. Compiling per call, so only for tests and one-offs. */
export function hostMatches(host: string, pattern: string): boolean {
  const matcher = compileHost(pattern);
  return matcher ? matcher(host) : true;
}

export function compareCandidates(criteria: SearchCriteria, a: Candidate, b: Candidate): number {
  let order: number;
  switch (criteria.sortBy) {
    case "method":
      order = caseInsensitive(a.request.getMethod(), b.request.getMethod());
      break;
    case "path":
      order = caseInsensitive(a.request.getPath(), b.request.getPath());
      break;
    case "status":
    case "status_code":
      order = (a.response?.getCode() ?? 0) - (b.response?.getCode() ?? 0);
      break;
    case "url":
      order = caseInsensitive(a.request.getUrl(), b.request.getUrl());
      break;
    default:
      order = a.createdAt - b.createdAt;
      break;
  }
  // URL is the tie-break, so re-comparing it when it was the primary key would
  // always yield 0 again.
  if (order === 0 && criteria.sortBy !== "url") {
    order = caseInsensitive(a.request.getUrl(), b.request.getUrl());
  }
  return criteria.sortAscending ? order : -order;
}

function caseInsensitive(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Best-effort HTTPQL prefilter.
 *
 * Only the structured fields that map exactly are emitted; everything nuanced
 * (globs, term containment, MIME type) is left to `matches` so semantics stay
 * identical to the Burp listener. If the query is rejected the caller falls
 * back to an unfiltered scan, so this can only ever make the scan cheaper,
 * never change the result set.
 *
 * Syntax note: HTTPQL wants the colon form (`req.method.eq:"GET"`, joined with
 * lowercase `and`). The space form shown in some docs - `req.method eq "GET"` -
 * is rejected as "Invalid filter" by Caido 0.57, which silently cost us the
 * prefilter entirely until it was verified against a live instance.
 */
export function buildHttpqlPrefilter(criteria: SearchCriteria): string {
  const clauses: string[] = [];

  if (criteria.location === "proxy_history") {
    // Burp's Proxy history is exactly the traffic that passed through the
    // proxy; Caido labels that source "intercept".
    clauses.push(`source:"intercept"`);
  }
  if (criteria.host && !criteria.host.includes("*")) {
    clauses.push(`req.host.eq:${quote(criteria.host)}`);
  }
  if (criteria.methods.size === 1) {
    const [method] = [...criteria.methods];
    clauses.push(`req.method.eq:${quote(method!)}`);
  }
  if (criteria.statuses.size === 1) {
    const [code] = [...criteria.statuses];
    clauses.push(`resp.code.eq:${code}`);
  }
  return clauses.join(" and ");
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ------------------------------------------------------------------ helpers

/** `pickStringList` without the blank entries, which are never valid terms. */
function terms(args: Json, key: string): string[] {
  return pickStringList(args, key).filter((value) => value.trim().length > 0);
}

function pushIfPresent(list: string[], value: string): void {
  if (value && value.trim()) list.push(value);
}

function parseTime(value: string): number | undefined {
  if (!value || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
