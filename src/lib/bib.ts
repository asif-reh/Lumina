export type BibEntry = {
  type: string;
  key: string;
  fields: Record<string, string>;
};

function collapseSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readBraced(source: string, start: number): { value: string; next: number } {
  let depth = 0;
  let out = "";
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "{") {
      if (depth > 0) out += ch;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value: collapseSpace(out), next: i + 1 };
      }
      out += ch;
    } else {
      out += ch;
    }
    i += 1;
  }
  return { value: collapseSpace(out), next: i };
}

function readQuoted(source: string, start: number): { value: string; next: number } {
  let out = "";
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' && source[i - 1] !== "\\") {
      return { value: collapseSpace(out), next: i + 1 };
    }
    out += ch;
    i += 1;
  }
  return { value: collapseSpace(out), next: i };
}

function readBare(source: string, start: number): { value: string; next: number } {
  let i = start;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "," || ch === "}" || ch === ")" || ch === "#") break;
    out += ch;
    i += 1;
  }
  return { value: out.trim(), next: i };
}

function readValue(source: string, start: number): { value: string; next: number } {
  let i = start;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  let piece: { value: string; next: number };
  if (source[i] === "{") piece = readBraced(source, i);
  else if (source[i] === '"') piece = readQuoted(source, i);
  else piece = readBare(source, i);

  let value = piece.value;
  i = piece.next;
  while (true) {
    let k = i;
    while (k < source.length && /\s/.test(source[k])) k += 1;
    if (source[k] !== "#") break;
    k += 1;
    const next = readValue(source, k);
    value = collapseSpace(`${value} ${next.value}`);
    i = next.next;
  }
  return { value, next: i };
}

function skipBalanced(source: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") depth -= 1;
    i += 1;
  }
  return i;
}

/**
 * Parse common BibTeX entries. @string and @preamble are skipped.
 * Values keep inner braces so title normalization can strip them later.
 */
export function parseBibTeX(input: string): BibEntry[] {
  const source = input.replace(/^\uFEFF/, "");
  const entries: BibEntry[] = [];
  let i = 0;

  while (i < source.length) {
    const at = source.indexOf("@", i);
    if (at < 0) break;
    let j = at + 1;
    while (j < source.length && /[A-Za-z]/.test(source[j])) j += 1;
    const type = source.slice(at + 1, j).toLowerCase();
    if (!type) {
      i = at + 1;
      continue;
    }
    while (j < source.length && /\s/.test(source[j])) j += 1;
    const opener = source[j];
    if (opener !== "{" && opener !== "(") {
      i = j;
      continue;
    }
    const closer = opener === "{" ? "}" : ")";
    j += 1;

    if (type === "comment" || type === "string" || type === "preamble") {
      i = type === "comment" && opener === "{" ? skipBalanced(source, j) : skipBalanced(source, j);
      continue;
    }

    const keyStart = j;
    while (j < source.length && source[j] !== "," && source[j] !== closer) j += 1;
    const key = source.slice(keyStart, j).trim();
    if (source[j] === ",") j += 1;

    const fields: Record<string, string> = {};
    while (j < source.length) {
      while (j < source.length && /[\s,]/.test(source[j])) j += 1;
      if (j >= source.length || source[j] === closer) break;
      const nameStart = j;
      while (j < source.length && /[A-Za-z0-9_-]/.test(source[j])) j += 1;
      const name = source.slice(nameStart, j).toLowerCase();
      if (!name) break;
      while (j < source.length && /\s/.test(source[j])) j += 1;
      if (source[j] !== "=") break;
      j += 1;
      const read = readValue(source, j);
      fields[name] = read.value;
      j = read.next;
    }

    if (key) entries.push({ type, key, fields });
    const closeAt = source.indexOf(closer, j);
    i = closeAt >= 0 ? closeAt + 1 : j + 1;
  }

  return entries;
}

export function entryDoi(entry: BibEntry): string | undefined {
  const direct = entry.fields.doi?.trim();
  if (direct) return direct;
  const url = entry.fields.url ?? "";
  const match = url.match(/doi\.org\/([^\s}]+)/i);
  return match?.[1];
}

export function entryArxivId(entry: BibEntry): string | undefined {
  const eprint = entry.fields.eprint?.trim();
  const archive = (entry.fields.archiveprefix ?? entry.fields.archivePrefix ?? "").toLowerCase();
  if (eprint && (archive === "arxiv" || /^\d{4}\.\d{4,5}(v\d+)?$/.test(eprint))) {
    return eprint.replace(/^arxiv:/i, "");
  }
  const journal = entry.fields.journal ?? "";
  const fromJournal = journal.match(/arXiv[:\s]+(\d{4}\.\d{4,5})/i);
  if (fromJournal) return fromJournal[1];
  const note = `${entry.fields.note ?? ""} ${entry.fields.number ?? ""}`;
  const fromNote = note.match(/arXiv[:\s]+(\d{4}\.\d{4,5})/i);
  return fromNote?.[1];
}
