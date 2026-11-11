import type { FilePatch, PatchHunk } from "@/lib/types";
import { quotesForCovered } from "@/lib/job-fit/ground";
import type { RequirementFit } from "@/lib/job-fit/types";
import { anchors, commentLine, escapeLatex } from "@/lib/job-fit/text";

const COVER_PATH = "job-fit/cover-letter.tex";

function countOf(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const found = haystack.indexOf(needle, from);
    if (found < 0) break;
    count += 1;
    from = found + needle.length;
  }
  return count;
}

function splitItems(block: string): { prefix: string; items: string[]; suffix: string } | null {
  const match = block.match(/^([\s\S]*?\\begin\{itemize\}[^\n]*\n?)(\\item\b[\s\S]*)(\\end\{itemize\})$/);
  if (!match) return null;
  const prefix = match[1] ?? "";
  const middle = match[2] ?? "";
  const suffix = match[3] ?? "";
  const items = middle.split(/(?=\\item\b)/).filter((part) => part.startsWith("\\item"));
  if (items.length < 2 || items.join("") !== middle) return null;
  return { prefix, items, suffix };
}

export function isPermutationHunk(hunk: PatchHunk): boolean {
  const before = splitItems(hunk.search);
  const after = splitItems(hunk.replace);
  if (!before || !after) return false;
  if (before.prefix !== after.prefix || before.suffix !== after.suffix) return false;
  if (before.items.length !== after.items.length) return false;
  const counts = new Map<string, number>();
  for (const item of before.items) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of after.items) {
    const left = counts.get(item) ?? 0;
    if (left === 0) return false;
    counts.set(item, left - 1);
  }
  return true;
}

function reorderBlock(block: string, covered: Set<string>): string | null {
  const parts = splitItems(block);
  if (!parts) return null;
  const decorated = parts.items.map((item, index) => {
    const tokens = new Set(anchors(item));
    let score = 0;
    for (const token of covered) if (tokens.has(token)) score += 1;
    return { item, index, score };
  });
  if (decorated.every((item) => item.score === 0)) return null;
  decorated.sort((a, b) => b.score - a.score || a.index - b.index);
  const next = `${parts.prefix}${decorated.map((item) => item.item).join("")}${parts.suffix}`;
  if (next === block) return null;
  return next;
}

function resumePatches(files: { path: string; content: string }[], covered: Set<string>): FilePatch[] {
  const patches: FilePatch[] = [];
  for (const file of files) {
    if (!file.path.endsWith(".tex")) continue;
    const pattern = /\\begin\{itemize\}[\s\S]*?\\end\{itemize\}/g;
    const hunks: PatchHunk[] = [];
    for (const match of file.content.matchAll(pattern)) {
      const block = match[0];
      if (!block || countOf(file.content, block) !== 1) continue;
      const next = reorderBlock(block, covered);
      if (!next) continue;
      const hunk = { search: block, replace: next };
      if (!isPermutationHunk(hunk)) continue;
      hunks.push(hunk);
    }
    if (hunks.length === 0) continue;
    patches.push({
      path: file.path,
      description: "Move bullets that match the posting above the others. The wording is unchanged.",
      hunks,
    });
  }
  return patches;
}

function coverLetter(role: string, quotes: string[], gaps: RequirementFit[]): string {
  const items = quotes.map((quote) => `\\item ${escapeLatex(quote)}`).join("\n");
  const gapLines = gaps.length
    ? gaps.map((gap) => commentLine(`Gap: ${gap.requirement.text}`))
    : ["% No gaps were flagged."];
  return [
    "\\documentclass{article}",
    "\\usepackage{geometry}",
    "\\usepackage{enumitem}",
    "\\begin{document}",
    "\\section*{Cover note}",
    "",
    "Each bullet below is copied from this project. Requirements with no supporting passage are comments, not claims.",
    "",
    "\\begin{itemize}",
    items,
    "\\end{itemize}",
    "",
    commentLine(`Posting: ${role}`),
    "% Gaps with no supporting evidence in this project:",
    ...gapLines,
    "\\end{document}",
    "",
  ].join("\n");
}

export function buildJobFitPatches(input: {
  files: { path: string; content: string }[];
  fits: RequirementFit[];
  role: string;
  coverLetter: boolean;
  existingPaths: Set<string>;
}): { patches: FilePatch[]; warnings: string[] } {
  const warnings: string[] = [];
  const covered = input.fits.filter((fit) => fit.status === "covered");
  const gaps = input.fits.filter((fit) => fit.status === "gap");
  const coveredAnchors = new Set(covered.flatMap((fit) => anchors(fit.requirement.text)));
  const patches = resumePatches(input.files, coveredAnchors);
  if (input.coverLetter) {
    const quotes = quotesForCovered(covered, input.files);
    if (quotes.length === 0) {
      warnings.push("No cover letter was proposed, because no requirement had a sentence that already appears in the project.");
    } else if (input.existingPaths.has(COVER_PATH)) {
      warnings.push(`${COVER_PATH} already exists. Job Fit will not overwrite it.`);
    } else {
      patches.push({
        path: COVER_PATH,
        description: "Optional cover note. Every bullet is copied from this project. Gaps stay in comments.",
        newFile: true,
        content: coverLetter(input.role, quotes, gaps),
      });
    }
  }
  if (patches.length === 0 && covered.length > 0) {
    warnings.push("No resume edit was proposed. Reordering would not change the current bullets, and a new claim was not invented.");
  }
  if (covered.length === 0) {
    warnings.push("No resume or cover letter edits were proposed, because no requirement was supported by this project.");
  }
  return { patches, warnings };
}
