import { chunkText } from "@/lib/intelligence/chunk";
import type { EvidenceSpan, JobRequirement, RequirementFit } from "@/lib/job-fit/types";
import { anchors, normalizeSpace } from "@/lib/job-fit/text";

const PROJECT_EXT = /\.(tex|ltx|md|bib)$/i;

export function projectEvidence(files: { path: string; content: string }[]): EvidenceSpan[] {
  return files
    .filter((file) => PROJECT_EXT.test(file.path))
    .flatMap((file) =>
      chunkText(file.path, file.content)
        .slice(0, 40)
        .map((chunk) => ({
          source: file.path,
          text: chunk.text,
          backend: "project" as const,
        })),
    );
}

export function spansFromRetrieval(text: string): { spans: EvidenceSpan[]; note?: string } {
  const trimmed = text.trim();
  if (!trimmed) return { spans: [], note: "Retrieval returned nothing." };
  const pattern = /^\((\d+)\)\s+(.+?)\s+\[([\d.]+)\]\n([\s\S]*?)(?=\n\(\d+\)\s|$)/gm;
  const spans: EvidenceSpan[] = [];
  for (const match of trimmed.matchAll(pattern)) {
    const body = match[4]?.trim() ?? "";
    const source = match[2]?.trim() ?? "";
    if (!body || !source) continue;
    spans.push({ source, text: body, backend: "vector" });
  }
  if (spans.length === 0) return { spans: [], note: trimmed.slice(0, 500) };
  return { spans };
}

export function spansFromGraph(text: string, files: { path: string; content: string }[]): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  for (const line of text.split("\n")) {
    const match = /^Claim: (.+)$/.exec(line.trim());
    if (!match?.[1]) continue;
    const claim = normalizeSpace(match[1]);
    const file = files.find((entry) => normalizeSpace(entry.content).toLowerCase().includes(claim.toLowerCase()));
    if (!file) continue;
    spans.push({ source: file.path, text: claim, backend: "graph" });
  }
  return spans;
}

function uniqueSpans(spans: EvidenceSpan[]): EvidenceSpan[] {
  const seen = new Set<string>();
  const kept: EvidenceSpan[] = [];
  for (const span of spans) {
    const key = `${span.backend}:${span.source}:${normalizeSpace(span.text).slice(0, 180)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(span);
  }
  return kept;
}

/**
 * A requirement is covered only when every anchor token appears in the
 * evidence. A metric or skill that never occurs in the project stays a gap.
 */
export function groundRequirements(requirements: JobRequirement[], evidence: EvidenceSpan[]): RequirementFit[] {
  return requirements.map((requirement) => {
    const need = anchors(requirement.text);
    if (need.length === 0) {
      return {
        requirement,
        status: "gap",
        evidence: [],
        missing: [],
        detail: "This requirement is too vague to match against project text, so it stays a gap.",
      };
    }
    const ranked = evidence
      .map((span) => {
        const have = new Set(anchors(span.text));
        const hits = need.filter((token) => have.has(token));
        return { span, hits };
      })
      .filter((item) => item.hits.length > 0)
      .sort((a, b) => b.hits.length - a.hits.length);
    const found = new Set(ranked.flatMap((item) => item.hits));
    const missing = need.filter((token) => !found.has(token));
    if (missing.length > 0 || ranked.length === 0) {
      const detail =
        missing.length > 0
          ? `No project passage contains: ${missing.join(", ")}.`
          : "No supporting passage in this project.";
      return { requirement, status: "gap", evidence: [], missing, detail };
    }
    return {
      requirement,
      status: "covered",
      evidence: uniqueSpans(ranked.slice(0, 3).map((item) => item.span)),
      missing: [],
      detail: `Supported by ${[...new Set(ranked.slice(0, 3).map((item) => item.span.source))].join(", ")}.`,
    };
  });
}

export function quotableLines(text: string): string[] {
  const withoutComments = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("%"))
    .join("\n");
  const items = [...withoutComments.matchAll(/\\item\s+([\s\S]*?)(?=\\item|\\end\{itemize\}|$)/g)]
    .map((match) => normalizeSpace(match[1] ?? ""))
    .filter((line) => line.length >= 20 && line.length <= 400);
  const plain = withoutComments.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, " ");
  const sentences = plain
    .split(/(?<=[.])\s+/)
    .map((line) => normalizeSpace(line))
    .filter((line) => line.length >= 40 && line.length <= 400 && !line.includes("\\"));
  return [...items, ...sentences];
}

export function quotesForCovered(
  fits: RequirementFit[],
  files: { path: string; content: string }[],
): string[] {
  const quotes: string[] = [];
  const used = new Set<string>();
  for (const fit of fits) {
    if (fit.status !== "covered") continue;
    const need = anchors(fit.requirement.text);
    let best: { line: string; hits: number } | null = null;
    for (const file of files) {
      const corpus = normalizeSpace(file.content).toLowerCase();
      for (const line of quotableLines(file.content)) {
        const hits = need.filter((token) => anchors(line).includes(token)).length;
        if (hits === 0) continue;
        if (!corpus.includes(normalizeSpace(line).toLowerCase())) continue;
        if (!best || hits > best.hits || (hits === best.hits && line.length < best.line.length)) {
          best = { line: normalizeSpace(line), hits };
        }
      }
    }
    if (!best) continue;
    const key = best.line.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    quotes.push(best.line);
    if (quotes.length >= 6) break;
  }
  return quotes;
}
