import { strFromU8, unzipSync } from "fflate";
import { findTexRoot } from "@/lib/cite-scan";

export type PlannedFile = {
  path: string;
  data: Uint8Array;
};

export type ImportPlan = {
  files: PlannedFile[];
  mainFile: string;
  warnings: string[];
};

const SKIP_DIRS = new Set([
  "__macosx",
  ".git",
  ".svn",
  "conversations",
  "conversation",
  "chats",
  "chat",
  ".chat",
  "prism-chat",
  "node_modules",
]);

const BUILD_EXT = new Set([
  "aux",
  "log",
  "out",
  "blg",
  "bbl",
  "fls",
  "fdb_latexmk",
  "toc",
  "lof",
  "lot",
  "synctex",
  "synctex.gz",
]);

const TEXT_EXT = new Set([
  "tex",
  "ltx",
  "bib",
  "sty",
  "cls",
  "bst",
  "txt",
  "md",
  "csv",
  "json",
  "tikz",
  "dtx",
  "ins",
  "cfg",
  "bbx",
  "cbx",
  "lbx",
  "rnw",
]);

const PREFERRED_MAIN = [
  "main.tex",
  "paper.tex",
  "manuscript.tex",
  "article.tex",
  "thesis.tex",
  "document.tex",
];

const MAX_FILES = 500;
const MAX_UNCOMPRESSED = 40 * 1024 * 1024;

function extension(filePath: string): string {
  const base = filePath.split("/").pop() ?? "";
  if (base.endsWith(".synctex.gz")) return "synctex.gz";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function isAppleDouble(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? "";
  return base.startsWith("._") || base === ".ds_store";
}

function skippedDir(filePath: string): boolean {
  return filePath
    .split("/")
    .slice(0, -1)
    .some((segment) => SKIP_DIRS.has(segment.toLowerCase()));
}

function looksLikeConversation(text: string): boolean {
  try {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data)) {
      return data.some(
        (item) =>
          !!item &&
          typeof item === "object" &&
          "role" in item &&
          "content" in item,
      );
    }
    if (!data || typeof data !== "object") return false;
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.messages)) return true;
    if (typeof record.conversation_id === "string" || typeof record.conversationId === "string") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function normalizeZipPath(raw: string): string | null {
  const slash = raw.replaceAll("\\", "/");
  if (!slash || slash.endsWith("/")) return null;
  const parts = slash.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return null;
  return parts.join("/");
}

function unwrapSingleRoot(files: PlannedFile[]): PlannedFile[] {
  if (files.length < 1) return files;
  const first = files[0]?.path.split("/")[0];
  if (!first) return files;
  if (!files.every((file) => file.path.startsWith(`${first}/`))) return files;
  return files.map((file) => ({
    ...file,
    path: file.path.slice(first.length + 1),
  }));
}

function chooseMain(files: PlannedFile[], warnings: string[]): string {
  const textFiles = files.flatMap((file) => {
    if (extension(file.path) !== "tex" && extension(file.path) !== "ltx") return [];
    const text = strFromU8(file.data);
    return [{ path: file.path, text }];
  });

  const magic = findTexRoot(textFiles);
  if (magic) {
    const hit = textFiles.find((file) => file.path === magic || file.path.endsWith(`/${magic}`));
    if (hit) return hit.path;
    warnings.push(`A TEX root comment pointed at ${magic}, which is not in the archive.`);
  }

  const withClass = textFiles.filter((file) => /\\documentclass\b/.test(file.text));
  const pool = withClass.length > 0 ? withClass : textFiles;
  if (pool.length === 0) {
    throw new Error("No LaTeX sources were found in that ZIP.");
  }

  const score = (filePath: string) => {
    const base = filePath.split("/").pop()?.toLowerCase() ?? "";
    const depth = filePath.split("/").length;
    const preferred = PREFERRED_MAIN.indexOf(base);
    const hasDocument = /\\begin\{document\}/.test(
      pool.find((file) => file.path === filePath)?.text ?? "",
    );
    return (preferred === -1 ? 20 : preferred) + depth * 2 + (hasDocument ? 0 : 5);
  };

  const ranked = [...pool].sort((a, b) => score(a.path) - score(b.path) || a.path.localeCompare(b.path));
  const winner = ranked[0]!;
  if (withClass.length > 1) {
    warnings.push(
      `Several files contain \\documentclass. Using ${winner.path} as the main document. You can change it in the file tree.`,
    );
  } else if (withClass.length === 0) {
    warnings.push(`No \\documentclass was found. Using ${winner.path} as the main document.`);
  }
  return winner.path;
}

export function planZipImport(bytes: Uint8Array): ImportPlan {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new Error("That file is not a ZIP archive Lumina can read.");
  }

  const warnings: string[] = [];
  const planned: PlannedFile[] = [];
  let uncompressed = 0;

  for (const [rawPath, data] of Object.entries(archive)) {
    const normalized = normalizeZipPath(rawPath);
    if (!normalized) continue;
    if (isAppleDouble(normalized) || skippedDir(normalized)) {
      warnings.push(`Skipped ${normalized}.`);
      continue;
    }
    const ext = extension(normalized);
    if (BUILD_EXT.has(ext)) continue;

    uncompressed += data.byteLength;
    if (uncompressed > MAX_UNCOMPRESSED) {
      throw new Error("That ZIP unpacks to more than 40 MB. Split the project or remove generated files.");
    }

    if (ext === "json") {
      const text = strFromU8(data.slice(0, Math.min(data.byteLength, 200_000)));
      if (looksLikeConversation(text)) {
        warnings.push(`Skipped conversation file ${normalized}.`);
        continue;
      }
    }

    if (planned.length >= MAX_FILES) {
      throw new Error("That ZIP has more than 500 files.");
    }
    planned.push({ path: normalized, data });
  }

  const files = unwrapSingleRoot(planned).filter((file) => file.path.length > 0);
  if (files.length === 0) {
    throw new Error("Nothing importable was left after skipping conversation files and build artifacts.");
  }

  const mainFile = chooseMain(files, warnings);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const skipped = warnings.filter((warning) => warning.startsWith("Skipped "));
  const rest = warnings.filter((warning) => !warning.startsWith("Skipped "));
  const summarized =
    skipped.length > 4
      ? [`Skipped ${skipped.length} non-manuscript files, including conversation exports and editor metadata.`, ...rest]
      : warnings;
  return { files, mainFile, warnings: summarized };
}

export function isTextPath(filePath: string): boolean {
  return TEXT_EXT.has(extension(filePath));
}

export { TEXT_EXT };
