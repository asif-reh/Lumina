import type { CitationSource } from "@/lib/types";

export type PublicRecord = {
  title: string;
  authors: string[];
  year?: string;
  doi?: string;
  url?: string;
  source: CitationSource;
};

const LATEX_COMMANDS: Record<string, string> = {
  latex: "latex",
  tex: "tex",
  emph: "",
  textit: "",
  textbf: "",
  textsc: "",
  textrm: "",
  textsf: "",
  texttt: "",
};

export function stripLatexTitle(input: string): string {
  return input
    .replace(/\\(?:LaTeX|Latex)/g, "LaTeX")
    .replace(/\\TeX/g, "TeX")
    .replace(/\\([A-Za-z]+)\*?/g, (_, name: string) => {
      const key = name.toLowerCase();
      return key in LATEX_COMMANDS ? ` ${LATEX_COMMANDS[key]} ` : " ";
    })
    .replace(/[{}]/g, " ");
}

export function normalizeTitle(input: string): string {
  return stripLatexTitle(input)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleSimilarity(a: string, b: string): number {
  const left = new Set(normalizeTitle(a).split(" ").filter((word) => word.length > 2));
  const right = new Set(normalizeTitle(b).split(" ").filter((word) => word.length > 2));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const word of left) {
    if (right.has(word)) intersection += 1;
  }
  return (2 * intersection) / (left.size + right.size);
}

export function normalizeDoi(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[.,;]+$/, "")
    .toLowerCase();
}

export function firstAuthorLastName(authorField: string | undefined): string | undefined {
  if (!authorField) return undefined;
  const withoutBraces = authorField.replace(/[{}]/g, " ").replace(/\s+/g, " ").trim();
  const first = withoutBraces.split(/\s+and\s+/i)[0]?.trim();
  if (!first) return undefined;
  if (first.includes(",")) {
    return first.split(",")[0]?.trim().toLowerCase();
  }
  const parts = first.split(" ").filter(Boolean);
  return parts[parts.length - 1]?.toLowerCase();
}

export function authorAgrees(authorField: string | undefined, recordAuthors: string[]): boolean {
  const last = firstAuthorLastName(authorField);
  if (!last) return true;
  const haystack = recordAuthors.join(" ").toLowerCase();
  return haystack.includes(last);
}

export function yearsAgree(entryYear: string | undefined, recordYear: string | undefined): boolean {
  if (!entryYear || !recordYear) return true;
  const a = Number(entryYear.slice(0, 4));
  const b = Number(recordYear.slice(0, 4));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) <= 1;
}

/**
 * A DOI lookup already resolved a record. Verified only when the title agrees,
 * or when the bibliography entry has no title to compare.
 */
export function judgeDoiHit(
  entryTitle: string | undefined,
  record: PublicRecord,
): "verified" | "mismatch" {
  if (!entryTitle || !entryTitle.trim()) return "verified";
  const score = titleSimilarity(entryTitle, record.title);
  return score >= 0.72 ? "verified" : "mismatch";
}

/**
 * A title/author search. "weak" must stay unverified — partial overlap is not a match.
 */
export function judgeSearchHit(
  entry: { title?: string; author?: string; year?: string },
  record: PublicRecord,
): "verified" | "weak" {
  if (!entry.title) return "weak";
  const score = titleSimilarity(entry.title, record.title);
  const yearOk = yearsAgree(entry.year, record.year);
  const authorOk = authorAgrees(entry.author, record.authors);
  if (score >= 0.9 && yearOk) return "verified";
  if (score >= 0.84 && yearOk && authorOk) return "verified";
  return "weak";
}
