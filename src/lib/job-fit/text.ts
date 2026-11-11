const STOP = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "both",
  "but",
  "by",
  "can",
  "each",
  "etc",
  "for",
  "from",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "more",
  "not",
  "of",
  "on",
  "or",
  "our",
  "out",
  "per",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "these",
  "they",
  "this",
  "those",
  "to",
  "via",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "within",
  "you",
  "your",
]);

export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function anchors(value: string): string[] {
  const stripped = value
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, " ")
    .toLowerCase()
    .replace(/c\+\+/g, " cplusplus ");
  const tokens = stripped.split(/[^a-z0-9+#]+/).filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    if (STOP.has(token)) continue;
    if (token.length >= 3 || /\d/.test(token)) kept.push(token);
  }
  return [...new Set(kept)];
}

export function escapeLatex(value: string): string {
  return value
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("$", "\\$")
    .replaceAll("&", "\\&")
    .replaceAll("#", "\\#")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("~", "\\textasciitilde{}")
    .replaceAll("^", "\\textasciicircum{}");
}

export function visibleText(tex: string): string {
  return tex
    .split("\n")
    .filter((line) => !line.trim().startsWith("%"))
    .join("\n");
}

export function commentLine(value: string): string {
  return `% ${value.replace(/[\r\n]+/g, " ").replace(/%/g, "").slice(0, 220)}`;
}
