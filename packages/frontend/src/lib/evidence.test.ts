import { describe, expect, it } from "vitest";
import type { Finding } from "shared";
import { evidencePanes, replayHint } from "./evidence";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 1,
    httpRecordUuids: [],
    scanUuid: "",
    url: "",
    hostname: "",
    moduleId: "mod",
    moduleName: "Module",
    description: "",
    severity: "HIGH",
    confidence: "firm",
    tags: [],
    matchedAt: [],
    foundAt: "",
    request: "",
    response: "",
    moduleType: "",
    moduleShort: "",
    findingSource: "",
    sourceFile: "",
    repoName: "",
    extractedResults: [],
    additionalEvidence: [],
    findingHash: "",
    createdAt: "",
    ...overrides,
  };
}

/** An `additional_evidence` entry: the two messages around the delimiter line. */
const pair = (request: string, response: string) => `${request}\n---------\n${response}`;

describe("evidencePanes", () => {
  it("has no panes at all when nothing is selected", () => {
    expect(evidencePanes(undefined)).toEqual([]);
  });

  it("leaves a lone pane unnumbered", () => {
    const panes = evidencePanes(finding({ request: "GET / HTTP/1.1", response: "HTTP/1.1 200" }));

    expect(panes).toEqual([
      { key: "primary", label: "Evidence", request: "GET / HTTP/1.1", response: "HTTP/1.1 200" },
    ]);
  });

  // The bug this module was extracted for: the pane the view opens on was empty,
  // which disabled Send to Replay and both copy actions with no way to tell why.
  it("drops the primary pane when the evidence is all in additionalEvidence", () => {
    const panes = evidencePanes(
      finding({ additionalEvidence: [pair("GET /a HTTP/1.1", "HTTP/1.1 200")] }),
    );

    expect(panes).toHaveLength(1);
    expect(panes[0]).toMatchObject({
      key: "evidence-0",
      label: "Evidence",
      request: "GET /a HTTP/1.1",
    });
  });

  it("numbers the panes once there is more than one", () => {
    const panes = evidencePanes(
      finding({
        request: "GET /a HTTP/1.1",
        additionalEvidence: [pair("GET /b HTTP/1.1", "HTTP/1.1 200")],
      }),
    );

    expect(panes.map((p) => [p.key, p.label])).toEqual([
      ["primary", "Evidence #1"],
      ["evidence-0", "Evidence #2"],
    ]);
  });

  it("keeps a pane that has only one half", () => {
    expect(evidencePanes(finding({ response: "HTTP/1.1 500" }))).toHaveLength(1);
  });

  it("skips an empty additional entry without shifting the keys of the rest", () => {
    const panes = evidencePanes(
      finding({ additionalEvidence: ["", pair("GET /b HTTP/1.1", "HTTP/1.1 200")] }),
    );

    expect(panes.map((p) => p.key)).toEqual(["evidence-1"]);
  });

  it("has nothing to show for a finding with no messages", () => {
    expect(evidencePanes(finding({ matchedAt: ["src/app.go:1"] }))).toEqual([]);
  });
});

describe("replayHint", () => {
  it("prefers the finding's own target", () => {
    const hint = replayHint(
      finding({ url: "https://example.com/a", matchedAt: ["src/app/handler.go:42"] }),
    );

    expect(hint).toBe("https://example.com/a");
  });

  // An agent finding matches a source file, so the first entry is no help; a
  // later one may still name the endpoint.
  it("skips a matchedAt entry that is not a URL", () => {
    const hint = replayHint(
      finding({ matchedAt: ["src/app/handler.go:42", "https://example.com/b"] }),
    );

    expect(hint).toBe("https://example.com/b");
  });

  it("falls back to the first entry when none of them is a URL", () => {
    expect(replayHint(finding({ matchedAt: ["src/app/handler.go:42"] }))).toBe(
      "src/app/handler.go:42",
    );
  });

  it("has nothing to offer when the finding names no target", () => {
    expect(replayHint(finding())).toBe("");
  });
});
