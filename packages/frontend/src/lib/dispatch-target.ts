import type { RawDispatchInput } from "shared";
import type { FrontendSDK } from "../types";

/**
 * Turning "what the user meant" into something dispatchable.
 *
 * Caido describes the current selection three different ways depending on how a
 * command was invoked and which page is open, and each shape needs different
 * handling. That knowledge lives here rather than in the plugin bootstrap so it
 * can be reasoned about - and tested - without mounting anything.
 */

export type ContextRequest = {
  id?: string;
  host?: string;
  port?: number;
  isTls?: boolean;
  path?: string;
  query?: string;
  raw?: string;
};

export type CommandContext = {
  type: string;
  requests?: ContextRequest[];
  request?: ContextRequest;
  response?: { raw?: string };
};

export type Selection = { kind: "Empty" } | { kind: "Selected"; main: string; secondary: string[] };

/** What a command should act on: stored rows, or raw messages with no id. */
export type DispatchTarget = { ids: string[]; raw: RawDispatchInput[] };

/** The minimum of the Caido SDK this module needs, so tests can supply a stub. */
export type TargetSources = {
  window: Pick<FrontendSDK["window"], "getContext">;
  replay: Pick<FrontendSDK["replay"], "getSessions" | "getEntry">;
};

export function targetCount(target: DispatchTarget): number {
  return target.ids.length + target.raw.length;
}

export function targetUrl(request: ContextRequest): string {
  const scheme = request.isTls ? "https" : "http";
  const host = request.host ?? "";
  const defaultPort = request.isTls ? 443 : 80;
  const port = request.port;
  const authority = port && port !== defaultPort ? `${host}:${port}` : host;
  const query = request.query ? `?${request.query}` : "";
  return `${scheme}://${authority}${request.path ?? "/"}${query}`;
}

/**
 * Normalises every context shape Caido can hand a command into one target set.
 *
 * The row table yields `RequestMeta[]`, which carry ids and can be fetched
 * server-side. The request editor yields a `RequestDraft` - an unsaved message
 * with **no id at all** - so those have to travel as raw bytes instead. Treating
 * every context as id-bearing is what made the editor shortcut silently do
 * nothing: the id list came back empty and the command returned early.
 */
export function collectTargets(context: CommandContext | undefined): DispatchTarget {
  const ids: string[] = [];
  const raw: RawDispatchInput[] = [];
  if (!context) return { ids, raw };

  for (const request of context.requests ?? []) {
    if (request.id) ids.push(request.id);
  }

  const single = context.request;
  if (single) {
    if (single.raw) {
      // Prefer the raw bytes when present: in an editor that is exactly what the
      // user is looking at, edits included, rather than the persisted version.
      raw.push({
        url: targetUrl(single),
        request: single.raw,
        response: context.response?.raw ?? null,
      });
    } else if (single.id && !ids.includes(single.id)) {
      ids.push(single.id);
    }
  }

  return { ids, raw };
}

function selectedIds(selection: Selection | undefined): string[] {
  if (!selection || selection.kind !== "Selected") return [];
  return [selection.main, ...selection.secondary];
}

/**
 * Request IDs selected on whichever page is active.
 *
 * A context menu tells a command what was clicked, but a *keyboard shortcut* has
 * no invocation target - Caido passes a bare `BaseContext`. Reading the page's
 * live selection is what lets a shortcut act on it at all.
 *
 * Each page names its selection differently, and Replay's holds *session* ids
 * rather than request ids - handing those to `sdk.requests.get` would find
 * nothing, so they are resolved through the session's entries first.
 */
export function pageSelectionIds(sdk: TargetSources): string[] {
  const page = sdk.window.getContext()?.page as
    | { kind?: string; selection?: Selection; requestSelection?: Selection }
    | undefined;
  if (!page) return [];

  if (page.kind === "Replay") {
    return selectedIds(page.selection).flatMap((sessionId) => replayRequestIds(sdk, sessionId));
  }
  // Sitemap splits its selection in two; the request one is what we can dispatch.
  return selectedIds(page.requestSelection ?? page.selection);
}

/**
 * The request behind a Replay session - its most recent entry.
 *
 * A session accumulates one entry per send, and the latest is what the editor is
 * showing, so that is the one the user means. An unsent session has no entry
 * carrying a request yet and contributes nothing.
 */
function replayRequestIds(sdk: TargetSources, sessionId: string): string[] {
  const session = sdk.replay.getSessions().find((s) => s.id === sessionId);
  const entryId = session?.entryIds[session.entryIds.length - 1];
  if (entryId === undefined) return [];
  const requestId = sdk.replay.getEntry(entryId)?.requestId;
  return requestId === undefined ? [] : [requestId];
}

/**
 * The targets a command should act on: whatever it was invoked with, falling
 * back to the active page's selection when the invocation carried none.
 */
export function resolveDispatchTargets(
  sdk: TargetSources,
  context: CommandContext | undefined,
): DispatchTarget {
  const target = collectTargets(context);
  if (targetCount(target) === 0) target.ids = pageSelectionIds(sdk);
  return target;
}
