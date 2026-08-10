/** The contract between the frontend commands and the backend dispatch service. */

/** The three dispatch workflows the context menu and shortcuts share. */
export type DispatchKind = "ingest" | "scan" | "agentScan";

/**
 * A request supplied as raw text rather than a stored id.
 *
 * The request editor hands commands a `RequestDraft`, which has no id because it
 * may never have been saved - an edited Replay tab, for instance. Dispatching
 * those means carrying the bytes directly, which also has the nicer property of
 * sending exactly what the user is looking at rather than the persisted version.
 *
 * `request` and `response` are **latin-1**: one byte per character, so a binary
 * body survives the trip through the frontend as text without UTF-8 mangling it.
 */
export type RawDispatchInput = {
  url: string;
  request: string;
  response?: string | null;
};
