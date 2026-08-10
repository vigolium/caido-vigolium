import { SEVERITY_LABELS, parseEvidence, type Finding } from "shared";

/**
 * Renders a finding as Markdown for the clipboard.
 *
 * Ported from the Burp extension's "Copy Finding as Markdown" so a report
 * pasted from either integration reads identically.
 */
export function findingToMarkdown(finding: Finding): string {
  const lines: string[] = [];
  lines.push(`# ${finding.moduleName}`, "");

  const meta: [string, string][] = [
    ["Severity", SEVERITY_LABELS[finding.severity]],
    ["Confidence", finding.confidence],
    ["Module type", finding.moduleType],
    ["Source", finding.findingSource],
    ["Module ID", finding.moduleId],
    ["Repo", finding.repoName],
    ["File", finding.sourceFile],
    ["Scan", finding.scanUuid],
    ["Found at", finding.foundAt],
    ["Tags", finding.tags.join(", ")],
  ];
  for (const [label, value] of meta) {
    if (value) lines.push(`- **${label}:** ${value}`);
  }
  lines.push("");

  if (finding.description) {
    lines.push("## Description", "", finding.description, "");
  }
  if (finding.moduleShort) {
    lines.push(`_${finding.moduleShort}_`, "");
  }
  if (finding.matchedAt.length > 0) {
    lines.push("## Matched at", "");
    for (const url of finding.matchedAt) lines.push(`- ${url}`);
    lines.push("");
  }
  if (finding.extractedResults.length > 0) {
    lines.push("## Extracted results", "", "```", ...finding.extractedResults, "```", "");
  }
  if (finding.request) {
    lines.push("## Request", "", "```http", finding.request, "```", "");
  }
  if (finding.response) {
    lines.push("## Response", "", "```http", finding.response, "```", "");
  }
  finding.additionalEvidence.forEach((raw, index) => {
    const evidence = parseEvidence(raw);
    lines.push(`## Evidence #${index + 1}`, "");
    if (evidence.request) lines.push("### Request", "", "```http", evidence.request, "```", "");
    if (evidence.response) lines.push("### Response", "", "```http", evidence.response, "```", "");
  });

  return lines.join("\n");
}

export function findingsToJson(findings: Finding[]): string {
  return JSON.stringify(
    findings.map((f) => ({
      id: f.id,
      severity: f.severity.toLowerCase(),
      module_id: f.moduleId,
      module_name: f.moduleName,
      description: f.description,
      confidence: f.confidence,
      found_at: f.foundAt,
      ...(f.matchedAt.length > 0 ? { matched_at: f.matchedAt } : {}),
      ...(f.tags.length > 0 ? { tags: f.tags } : {}),
    })),
    null,
    2,
  );
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function downloadFile(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
