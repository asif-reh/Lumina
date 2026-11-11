import fs from "fs";
import path from "path";
import { strFromU8 } from "fflate";
import type { FileNode, LogDiagnostic, ProjectMeta, ProjectSummary } from "@/lib/types";
import {
  buildDir,
  dataDir,
  ensureDir,
  filesDir,
  projectDir,
  resolveInside,
  safeRelative,
} from "@/lib/paths";
import { isTextPath } from "@/lib/zip-import";

const SAMPLE_ID = "sample-note";

export function textFile(relative: string): boolean {
  return isTextPath(relative);
}

function metaPath(id: string): string {
  return path.join(projectDir(id), "project.json");
}

export function readMeta(id: string): ProjectMeta {
  const raw = fs.readFileSync(metaPath(id), "utf8");
  const parsed = JSON.parse(raw) as ProjectMeta;
  if (!parsed?.id || !parsed.mainFile || !parsed.name) {
    throw new Error("Project metadata is incomplete.");
  }
  return parsed;
}

function writeMeta(meta: ProjectMeta) {
  ensureDir(projectDir(meta.id));
  fs.writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

export function touchProject(id: string, patch: Partial<Pick<ProjectMeta, "name" | "mainFile">> = {}) {
  const current = readMeta(id);
  const next: ProjectMeta = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeMeta(next);
  return next;
}

function walk(dir: string, prefix: string): FileNode[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: FileNode[] = entries
    .filter((entry) => entry.name !== ".DS_Store")
    .map((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: rel,
          type: "dir" as const,
          children: walk(path.join(dir, entry.name), rel),
        };
      }
      return { name: entry.name, path: rel, type: "file" as const };
    });
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export function fileTree(id: string): FileNode[] {
  return walk(filesDir(id), "");
}

export function listProjects(): ProjectSummary[] {
  ensureWorkspace();
  const root = path.join(dataDir(), "projects");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        const meta = readMeta(entry.name);
        return [{ ...meta, hasPdf: pdfPath(entry.name) !== null }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readTextFile(id: string, relative: string): string {
  const full = resolveInside(filesDir(id), relative);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error("File not found.");
  }
  if (!textFile(safeRelative(relative))) {
    throw new Error("That file is binary. Open it from the preview, not the editor.");
  }
  return fs.readFileSync(full, "utf8");
}

export function tryReadText(id: string, relative: string): string | null {
  try {
    return readTextFile(id, relative);
  } catch {
    return null;
  }
}

export function writeTextFile(id: string, relative: string, content: string) {
  if (typeof content !== "string") throw new Error("File content must be text.");
  if (content.length > 1_500_000) throw new Error("File is larger than 1.5 MB.");
  const rel = safeRelative(relative);
  const full = resolveInside(filesDir(id), rel);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, content);
  touchProject(id);
}

export function writeBinaryFile(id: string, relative: string, data: Uint8Array) {
  const rel = safeRelative(relative);
  const full = resolveInside(filesDir(id), rel);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, data);
}

export function deletePath(id: string, relative: string) {
  const rel = safeRelative(relative);
  const meta = readMeta(id);
  if (rel === meta.mainFile) {
    throw new Error("The main document cannot be deleted. Choose another main file first.");
  }
  const full = resolveInside(filesDir(id), rel);
  if (!fs.existsSync(full)) throw new Error("File not found.");
  fs.rmSync(full, { recursive: true, force: true });
  touchProject(id);
}

export function listTextFiles(id: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const visit = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.type === "dir" && node.children) visit(node.children);
      else if (node.type === "file" && textFile(node.path)) {
        const content = tryReadText(id, node.path);
        if (content !== null && content.length <= 200_000) {
          out.push({ path: node.path, content });
        }
      }
    }
  };
  visit(fileTree(id));
  return out;
}

function copySampleFiles(target: string) {
  const source = path.join(process.cwd(), "sample-project");
  if (!fs.existsSync(source)) {
    throw new Error("sample-project is missing from the Lumina install.");
  }
  fs.cpSync(source, target, { recursive: true });
}

export function createProject(name: string, options?: { seed?: "blank" | "sample"; id?: string }): ProjectMeta {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) throw new Error("Give the project a name under 120 characters.");
  const id =
    options?.id ??
    `${trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "project"}-${crypto.randomUUID().slice(0, 8)}`;
  const root = filesDir(id);
  if (fs.existsSync(projectDir(id))) throw new Error("A project with that id already exists.");
  ensureDir(root);
  const now = new Date().toISOString();
  const mainFile = "main.tex";
  if (options?.seed === "sample") {
    copySampleFiles(root);
  } else {
    const starter = `\\documentclass{article}\n\\begin{document}\n\\section{${trimmed.replaceAll(/[{}\\]/g, "")}}\n\nStart writing.\n\\end{document}\n`;
    fs.writeFileSync(path.join(root, "main.tex"), starter);
  }
  const meta: ProjectMeta = {
    id,
    name: trimmed,
    mainFile,
    createdAt: now,
    updatedAt: now,
  };
  writeMeta(meta);
  return meta;
}

export function importProject(name: string, files: { path: string; data: Uint8Array }[], mainFile: string): ProjectMeta {
  const meta = createProject(name, { seed: "blank" });
  const root = filesDir(meta.id);
  fs.rmSync(root, { recursive: true, force: true });
  ensureDir(root);
  for (const file of files) {
    writeBinaryFile(meta.id, file.path, file.data);
  }
  const main = safeRelative(mainFile);
  if (!fs.existsSync(resolveInside(root, main))) {
    throw new Error("The detected main file was not written.");
  }
  return touchProject(meta.id, { mainFile: main, name: meta.name });
}

export function deleteProject(id: string) {
  const dir = projectDir(id);
  if (!fs.existsSync(dir)) throw new Error("Project not found.");
  fs.rmSync(dir, { recursive: true, force: true });
}

export function pdfPath(id: string): string | null {
  const meta = readMeta(id);
  const base = path.basename(meta.mainFile, path.extname(meta.mainFile));
  const candidate = path.join(buildDir(id), `${base}.pdf`);
  if (fs.existsSync(candidate)) return candidate;
  const dir = buildDir(id);
  if (!fs.existsSync(dir)) return null;
  const fallback = fs.readdirSync(dir).find((name) => name.endsWith(".pdf"));
  return fallback ? path.join(dir, fallback) : null;
}

export function readCompileLog(id: string): string {
  const file = path.join(buildDir(id), "compile.log");
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

export function readDiagnostics(id: string): LogDiagnostic[] {
  const file = path.join(buildDir(id), "diagnostics.json");
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as LogDiagnostic[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ensureWorkspace() {
  const root = path.join(dataDir(), "projects");
  if (fs.existsSync(root)) return;
  ensureDir(root);
  createProject("Sample note", { seed: "sample", id: SAMPLE_ID });
}

export function rawFile(id: string, relative: string): { full: string; name: string } {
  const rel = safeRelative(relative);
  const full = resolveInside(filesDir(id), rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error("File not found.");
  return { full, name: path.basename(rel) };
}

export function readFileBytes(id: string, relative: string): Buffer {
  return fs.readFileSync(rawFile(id, relative).full);
}

export function decodeImportedText(data: Uint8Array): string {
  return strFromU8(data);
}
