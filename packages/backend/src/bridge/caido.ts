import type { SDK } from "caido:plugin";
import { RequestSpecRaw } from "caido:utils";
import type { Request, Response } from "caido:utils";
import { errorMessage } from "shared";
import { toBase64 } from "../util/bytes";
import { REQUEST_PAGE_SIZE } from "../util/limits";
import { parseRequestLine, parseStatusCode, parseTarget } from "../util/rawhttp";
import {
  type Candidate,
  type SearchCriteria,
  buildHttpqlPrefilter,
  compareCandidates,
  deriveMatcher,
  matches,
} from "./search";

/**
 * Upper bound on requests examined per search.
 *
 * Search sorts globally before paging, which means scanning. A busy project can
 * hold hundreds of thousands of requests, so the scan is bounded and the cut is
 * reported rather than silently truncating the result set.
 */
const MAX_SCAN = 20_000;

export type ScanResult = {
  candidates: Candidate[];
  /** True when the scan cap was reached, so `total` is a floor, not an exact count. */
  truncated: boolean;
  scanned: number;
};

/**
 * Pages through the project's requests, applying the HTTPQL prefilter where it
 * maps cleanly and the faithful predicate set in JS.
 */
export async function scanCandidates(sdk: SDK, criteria: SearchCriteria): Promise<ScanResult> {
  const prefilter = buildHttpqlPrefilter(criteria);
  const matcher = deriveMatcher(criteria);
  let cursor: string | undefined;
  let scanned = 0;
  let truncated = false;
  const candidates: Candidate[] = [];

  // A rejected prefilter must never change results, only performance.
  let activeFilter = prefilter;
  let filterDisabled = false;

  for (;;) {
    let page;
    try {
      let query = sdk.requests.query().first(REQUEST_PAGE_SIZE);
      if (activeFilter && !filterDisabled) query = query.filter(activeFilter);
      if (cursor) query = query.after(cursor);
      query = criteria.sortAscending
        ? query.ascending("req", "created_at")
        : query.descending("req", "created_at");
      page = await query.execute();
    } catch (e) {
      if (!filterDisabled && activeFilter) {
        sdk.console.warn(
          `[Vigolium] HTTPQL prefilter rejected (${errorMessage(e)}); scanning unfiltered`,
        );
        filterDisabled = true;
        cursor = undefined;
        scanned = 0;
        candidates.length = 0;
        continue;
      }
      throw e;
    }

    if (page.items.length === 0) break;

    for (const item of page.items) {
      scanned += 1;
      const candidate = toCandidate(item.request, item.response);
      const inScope = criteria.inScopeOnly ? sdk.requests.inScope(item.request) : true;
      if (matches(matcher, candidate, inScope)) candidates.push(candidate);
    }

    cursor = page.pageInfo.endCursor;
    if (!page.pageInfo.hasNextPage) break;
    if (scanned >= MAX_SCAN) {
      truncated = true;
      break;
    }
  }

  candidates.sort((a, b) => compareCandidates(criteria, a, b));
  return { candidates, truncated, scanned };
}

export function toCandidate(request: Request, response: Response | undefined): Candidate {
  return { request, response, createdAt: request.getCreatedAt().getTime() };
}

export async function loadCandidate(sdk: SDK, requestId: string): Promise<Candidate> {
  const found = await sdk.requests.get(requestId);
  if (!found?.request) throw new Error("Caido ref expired or unknown; search again");
  return toCandidate(found.request, found.response);
}

// -------------------------------------------------------------- Injection

export type InjectInput = {
  url: string;
  requestBytes: Uint8Array;
  responseBytes: Uint8Array | null;
  /** Free-text label from the caller, recorded for traceability. */
  source: string;
  roundtripTimeMs?: number;
};

const CREATE_REQUEST = `
  mutation VigoliumCreateRequest($input: CreateRequestInput!) {
    createRequest(input: $input) {
      id
      responseId
    }
  }
`;

const CREATE_SITEMAP_ENTRIES = `
  mutation VigoliumCreateSitemapEntries($requestId: ID!) {
    createSitemapEntries(requestId: $requestId) {
      __typename
    }
  }
`;

type CreateRequestData = {
  createRequest?: { id?: string | null; responseId?: string | null } | null;
};

/**
 * Stores a request (and optional response) in Caido without sending it.
 *
 * This is the counterpart to Burp's `SiteMap.add`: the bytes are recorded
 * verbatim as project traffic, then filed into the Sitemap tree. Nothing goes
 * on the wire - that distinction is what makes `vigolium traffic --save-to-burp`
 * safe to run against a large result set.
 */
export async function injectRequest(sdk: SDK, input: InjectInput): Promise<string> {
  const { host, port, isTls } = parseTarget(input.url);
  const { method, path, query } = parseRequestLine(input.requestBytes);

  const variables: Record<string, unknown> = {
    input: {
      host,
      port,
      isTls,
      method,
      path,
      query,
      raw: toBase64(input.requestBytes),
      source: "PLUGIN",
      alteration: "NONE",
      ...(isTls ? { sni: host } : {}),
      ...(input.responseBytes && input.responseBytes.length > 0
        ? {
            response: {
              raw: toBase64(input.responseBytes),
              statusCode: parseStatusCode(input.responseBytes),
              roundtripTime: Math.max(0, Math.trunc(input.roundtripTimeMs ?? 0)),
              source: "PLUGIN",
              alteration: "NONE",
            },
          }
        : {}),
    },
  };

  const result = await sdk.graphql.execute<CreateRequestData>(CREATE_REQUEST, variables);
  if (result.errors && result.errors.length > 0) {
    throw new Error(`Caido rejected the request import: ${result.errors[0]?.message ?? "unknown"}`);
  }
  const id = result.data?.createRequest?.id;
  if (!id) throw new Error("Caido did not return an id for the imported request");
  return id;
}

export async function addToSitemap(sdk: SDK, requestId: string): Promise<void> {
  const result = await sdk.graphql.execute(CREATE_SITEMAP_ENTRIES, { requestId });
  if (result.errors && result.errors.length > 0) {
    throw new Error(`Caido rejected the sitemap entry: ${result.errors[0]?.message ?? "unknown"}`);
  }
}

// ------------------------------------------------------------------ Replay

/**
 * Finds or creates a Replay collection by name.
 *
 * Caido's collections are the closest analogue to grouping a batch of items for
 * manual follow-up - the role Burp's Organizer plays, except Burp's list is
 * flat and unnamed.
 */
export async function resolveCollectionId(sdk: SDK, name: string): Promise<string | undefined> {
  const wanted = name.trim();
  if (!wanted) return undefined;

  const collections = await sdk.replay.getCollections();
  const existing = collections.find((c) => c.getName() === wanted);
  if (existing) return existing.getId();

  const result = await sdk.graphql.execute<{
    createReplaySessionCollection?: { collection?: { id?: string | null } | null } | null;
  }>(
    `mutation VigoliumCreateCollection($input: CreateReplaySessionCollectionInput!) {
       createReplaySessionCollection(input: $input) { collection { id } }
     }`,
    { input: { name: wanted } },
  );
  if (result.errors && result.errors.length > 0) return undefined;
  return result.data?.createReplaySessionCollection?.collection?.id ?? undefined;
}

export async function renameSession(sdk: SDK, sessionId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await sdk.graphql.execute(
    `mutation VigoliumRenameSession($id: ID!, $name: String!) {
       renameReplaySession(id: $id, name: $name) { session { id } }
     }`,
    { id: sessionId, name: trimmed },
  );
}

/**
 * Imports a message and opens it in a named Replay session.
 *
 * Caido has no "session from raw bytes" entry point, so the bytes have to be
 * recorded as project traffic first. Every caller that stages a request for
 * manual follow-up - /repeater, /organizer and the HTTP records tab - needs the
 * same three steps in the same order, so they share this one.
 */
export async function openInReplay(
  sdk: SDK,
  input: InjectInput,
  name: string,
  collectionId?: string,
): Promise<string> {
  const requestId = await injectRequest(sdk, input);
  const session = await sdk.replay.createSession(requestId, collectionId);
  await renameSession(sdk, session.getId(), name);
  return session.getId();
}

// -------------------------------------------------------------------- Send

export type SendOutcome = {
  blocked: boolean;
  sent: boolean;
  statusCode: number;
  responseBytes: Uint8Array;
  elapsedMs: number | undefined;
  error: string | undefined;
};

export const OUT_OF_SCOPE: SendOutcome = {
  blocked: true,
  sent: false,
  statusCode: 0,
  responseBytes: new Uint8Array(0),
  elapsedMs: undefined,
  error: undefined,
};

export type SendOptions = {
  timeoutMs: number;
  enforceInScope: boolean;
  /** Persist the exchange in the project (shows up under Search). */
  save: boolean;
};

/**
 * Issues raw request bytes through Caido's own HTTP engine.
 *
 * `RequestSpecRaw` puts the supplied bytes on the wire unnormalised, which is
 * the whole point of `--send-via-burp`: deliberate Content-Length, smuggling
 * payloads and unusual methods must survive intact.
 */
export async function sendRaw(
  sdk: SDK,
  url: string,
  requestBytes: Uint8Array,
  options: SendOptions,
): Promise<SendOutcome> {
  const spec = new RequestSpecRaw(url);
  spec.setRaw(requestBytes);

  if (options.enforceInScope && !sdk.requests.inScope(spec.toSpec())) {
    return OUT_OF_SCOPE;
  }

  const startedAt = Date.now();
  try {
    const payload = await sdk.requests.send(spec, {
      timeouts: { global: options.timeoutMs },
      save: options.save,
    });
    const response = payload.response;
    return {
      blocked: false,
      sent: true,
      statusCode: response?.getCode() ?? 0,
      responseBytes: response ? response.getRaw().toBytes() : new Uint8Array(0),
      elapsedMs: response?.getRoundtripTime?.() ?? Date.now() - startedAt,
      error: undefined,
    };
  } catch (e) {
    // A target-side failure is not a bridge failure: report it inline so
    // per-request outcomes stay uniform when fuzzing.
    return {
      blocked: false,
      sent: false,
      statusCode: 0,
      responseBytes: new Uint8Array(0),
      elapsedMs: undefined,
      error: errorMessage(e),
    };
  }
}
