import fs from "fs";
import path from "path";

export function dataDir(): string {
  const fromEnv = process.env.LUMINA_DATA_DIR?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(process.cwd(), "data");
}

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/;

export function assertProjectId(id: string): string {
  if (!ID_RE.test(id)) {
    throw new Error("Invalid project id.");
  }
  return id;
}

export function projectDir(id: string): string {
  return path.join(dataDir(), "projects", assertProjectId(id));
}

export function filesDir(id: string): string {
  return path.join(projectDir(id), "files");
}

export function buildDir(id: string): string {
  return path.join(projectDir(id), "build");
}

/** Normalize a user-supplied relative path and reject traversal. */
export function safeRelative(input: string): string {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
    throw new Error("Invalid path.");
  }
  const slash = input.replaceAll("\\", "/").trim();
  if (slash.startsWith("/") || /^[a-zA-Z]:/.test(slash)) {
    throw new Error("Absolute paths are not allowed.");
  }
  const normalized = path.posix.normalize(slash).replace(/^\/+/, "");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..") ||
    normalized === "."
  ) {
    throw new Error("Path escapes the project.");
  }
  if (!normalized || normalized.endsWith("/")) {
    throw new Error("Invalid path.");
  }
  return normalized;
}

export function resolveInside(root: string, relative: string): string {
  const rel = safeRelative(relative);
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, rel);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    throw new Error("Path escapes the project.");
  }
  return full;
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function tectonicCacheDir(): string {
  const dir = path.join(dataDir(), "tectonic-cache");
  ensureDir(dir);
  return dir;
}
