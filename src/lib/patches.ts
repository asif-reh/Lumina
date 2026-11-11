import { createTwoFilesPatch } from "diff";
import type { FilePatch, PatchHunk } from "@/lib/types";
import { safeRelative } from "@/lib/paths";

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function countOccurrences(haystack: string, needle: string): number {
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

export function applyHunks(original: string, hunks: PatchHunk[]): string {
  let text = normalizeNewlines(original);
  if (hunks.length === 0) {
    throw new PatchError("Patch has no edits.");
  }
  for (const hunk of hunks) {
    const search = normalizeNewlines(hunk.search ?? "");
    const replace = normalizeNewlines(hunk.replace ?? "");
    if (!search) {
      throw new PatchError("A search string was empty. Refusing to apply a blind replace.");
    }
    const occurrences = countOccurrences(text, search);
    if (occurrences === 0) {
      const preview = search.length > 80 ? `${search.slice(0, 80)}…` : search;
      throw new PatchError(`Search text was not found: ${preview}`);
    }
    if (occurrences > 1 && !hunk.replaceAll) {
      throw new PatchError(
        `Search text matched ${occurrences} places. Narrow it, or set replaceAll.`,
      );
    }
    text = hunk.replaceAll ? text.replaceAll(search, replace) : text.replace(search, replace);
  }
  return text;
}

export function renderDiff(path: string, before: string, after: string): string {
  return createTwoFilesPatch(
    path,
    path,
    normalizeNewlines(before),
    normalizeNewlines(after),
    "current",
    "proposed",
    { context: 3 },
  );
}

export function previewPatch(original: string | null, patch: FilePatch): { next: string; diff: string } {
  const filePath = safeRelative(patch.path);
  if (patch.newFile) {
    if (original !== null) {
      throw new PatchError(`${filePath} already exists. Refusing to create it again.`);
    }
    const content = normalizeNewlines(patch.content ?? "");
    if (!content.trim()) {
      throw new PatchError("New file content is empty.");
    }
    return { next: content, diff: renderDiff(filePath, "", content) };
  }
  if (original === null) {
    throw new PatchError(`${filePath} does not exist. Mark the patch as a new file.`);
  }
  const next = applyHunks(original, patch.hunks ?? []);
  return { next, diff: renderDiff(filePath, original, next) };
}

export function applyPatchSequence(
  read: (filePath: string) => string | null,
  patches: FilePatch[],
): { path: string; next: string; diff: string }[] {
  const overlays = new Map<string, string | null>();
  const results: { path: string; next: string; diff: string }[] = [];

  for (const patch of patches) {
    const filePath = safeRelative(patch.path);
    const original = overlays.has(filePath) ? overlays.get(filePath)! : read(filePath);
    const preview = previewPatch(original, { ...patch, path: filePath });
    overlays.set(filePath, preview.next);
    results.push({ path: filePath, next: preview.next, diff: preview.diff });
  }

  return results;
}
