import { parseEvidence, type Finding } from "shared";

/**
 * Which messages a finding actually carries, and where they were sent.
 *
 * Both answers used to be derived inline in the detail view, where neither could
 * be tested - and both were wrong in the same way: they assumed a finding has a
 * primary request/response pair and that `matchedAt` names a URL. An agent
 * finding satisfies neither.
 */

/** One request/response pair, as the detail view shows it. */
export type EvidencePane = {
  key: string;
  label: string;
  request: string;
  response: string;
};

/**
 * The finding's evidence pairs, in order, skipping the ones that hold nothing.
 *
 * A finding's own `request`/`response` is the first pair, but it need not have
 * one: an agent finding keeps its whole exchange in `additionalEvidence`
 * instead. Kept as an empty first pane, that pair is what the view opens on -
 * blank, with Send to Replay and both copy actions disabled because they read
 * the open pane - which is indistinguishable from the feature being broken.
 *
 * Keys stay tied to where the pair came from rather than to its position, so a
 * dropped empty primary does not silently renumber which pane a stored tab
 * selection refers to.
 */
export function evidencePanes(finding: Finding | undefined): EvidencePane[] {
  if (!finding) return [];

  const pairs = [
    { key: "primary", request: finding.request, response: finding.response },
    ...finding.additionalEvidence.map((raw, index) => ({
      key: `evidence-${index}`,
      ...parseEvidence(raw),
    })),
  ].filter((pair) => pair.request !== "" || pair.response !== "");

  // Numbered only when there is more than one: a lone "Evidence #1" reads as if
  // a second tab failed to load.
  return pairs.map((pair, index) => ({
    ...pair,
    label: pairs.length > 1 ? `Evidence #${index + 1}` : "Evidence",
  }));
}

/**
 * The best guess at where this finding's evidence was sent.
 *
 * The backend reconciles this against the message's own `Host` header and only
 * needs it when the message carries none - which is exactly the case for an
 * agent finding, whose `matchedAt[0]` is a source file path and no help at all.
 * The server's own `url` is the authority; `matchedAt` is consulted only after
 * it, and then for whichever entry is actually a URL rather than the first.
 */
export function replayHint(finding: Finding): string {
  if (finding.url) return finding.url;
  const matched = finding.matchedAt.find((at) => /^https?:\/\//i.test(at));
  return matched ?? finding.matchedAt[0] ?? "";
}
