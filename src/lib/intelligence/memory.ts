import fs from "fs";
import path from "path";
import type { BibEntry } from "@/lib/bib";
import { extractCitationKeys } from "@/lib/cite-scan";
import { dataDir, ensureDir } from "@/lib/paths";
import type { CitationReport } from "@/lib/types";

export type MemoryNode = {
  id: string;
  type: "manuscript" | "paper" | "author" | "claim" | "evidence";
  label: string;
  props: Record<string, string>;
};

export type MemoryEdge = {
  id: string;
  source: string;
  target: string;
  type: "authored" | "cites" | "supports" | "evidences";
};

export type ProjectMemory = {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function sentencesAround(text: string, key: string): string[] {
  const pattern = new RegExp(`\\\\(?:cite\\w*|autocite|textcite|parencite)\\*?[^\\n]{0,40}\\{[^}]*\\b${key}\\b[^}]*\\}`);
  return text
    .split(/(?<=[.?!])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 40 && pattern.test(sentence))
    .slice(0, 3);
}

function authorNames(field: string | undefined): string[] {
  if (!field) return [];
  return field
    .split(/\s+and\s+/i)
    .map((name) => name.replace(/[{}]/g, "").trim())
    .filter((name) => name.length > 1)
    .slice(0, 12);
}

export function buildMemory(input: {
  entries: BibEntry[];
  texFiles: { path: string; content: string }[];
  verification?: Record<string, { status: string; detail: string }>;
}): ProjectMemory {
  const nodes: MemoryNode[] = [
    {
      id: "manuscript",
      type: "manuscript",
      label: "This manuscript",
      props: {},
    },
  ];
  const edges: MemoryEdge[] = [];
  const cited = new Set<string>();
  for (const file of input.texFiles) {
    for (const key of extractCitationKeys(file.content)) cited.add(key);
  }

  for (const entry of input.entries) {
    const paperId = `paper:${entry.key}`;
    const check = input.verification?.[entry.key];
    nodes.push({
      id: paperId,
      type: "paper",
      label: entry.fields.title || entry.key,
      props: {
        key: entry.key,
        year: entry.fields.year ?? "",
        doi: entry.fields.doi ?? "",
        status: check?.status ?? (cited.has(entry.key) ? "unchecked" : "uncited"),
        detail: check?.detail ?? "",
        cited: cited.has(entry.key) ? "yes" : "no",
      },
    });
    for (const name of authorNames(entry.fields.author)) {
      const authorId = `author:${slug(name)}`;
      if (!nodes.some((node) => node.id === authorId)) {
        nodes.push({ id: authorId, type: "author", label: name, props: {} });
      }
      edges.push({
        id: `authored:${authorId}:${paperId}`,
        source: authorId,
        target: paperId,
        type: "authored",
      });
    }
    if (cited.has(entry.key)) {
      edges.push({
        id: `cites:${paperId}`,
        source: "manuscript",
        target: paperId,
        type: "cites",
      });
    }
  }

  for (const key of cited) {
    if (input.entries.some((entry) => entry.key === key)) continue;
    const paperId = `paper:${key}`;
    nodes.push({
      id: paperId,
      type: "paper",
      label: key,
      props: { key, status: "missing", cited: "yes", detail: "Cited with no bibliography entry." },
    });
    edges.push({ id: `cites:${paperId}`, source: "manuscript", target: paperId, type: "cites" });
  }

  for (const file of input.texFiles) {
    const keys = new Set(extractCitationKeys(file.content));
    for (const key of keys) {
      for (const sentence of sentencesAround(file.content, key)) {
        const claimId = `claim:${slug(sentence).slice(0, 48)}`;
        const evidenceId = `evidence:${file.path}:${claimId}`;
        if (!nodes.some((node) => node.id === claimId)) {
          nodes.push({ id: claimId, type: "claim", label: sentence.slice(0, 280), props: { file: file.path } });
        }
        nodes.push({
          id: evidenceId,
          type: "evidence",
          label: sentence.slice(0, 280),
          props: { file: file.path, key },
        });
        edges.push({ id: `ev:${evidenceId}`, source: evidenceId, target: `paper:${key}`, type: "evidences" });
        edges.push({ id: `sup:${evidenceId}`, source: evidenceId, target: claimId, type: "supports" });
        edges.push({ id: `psup:${key}:${claimId}`, source: `paper:${key}`, target: claimId, type: "supports" });
      }
    }
  }

  return { nodes, edges };
}

export function queryMemory(memory: ProjectMemory, kind: "summary" | "unverified" | "supports", text = ""): string {
  if (kind === "summary") {
    const counts = memory.nodes.reduce<Record<string, number>>((map, node) => {
      map[node.type] = (map[node.type] ?? 0) + 1;
      return map;
    }, {});
    return `Graph memory: ${Object.entries(counts)
      .map(([type, count]) => `${count} ${type}`)
      .join(", ")}. ${memory.edges.length} edges.`;
  }

  if (kind === "unverified") {
    const rows = memory.nodes.filter(
      (node) =>
        node.type === "paper" &&
        node.props.cited === "yes" &&
        node.props.status !== "verified",
    );
    if (rows.length === 0) return "Every cited paper in the graph is marked verified, or the graph has not been built yet.";
    return rows
      .map((node) => `${node.props.key}: ${node.props.status} — ${node.label}`)
      .join("\n");
  }

  const needle = text.trim().toLowerCase();
  if (!needle) return "Provide a claim or phrase to look up in the graph.";
  const claims = memory.nodes.filter(
    (node) => node.type === "claim" && node.label.toLowerCase().includes(needle),
  );
  if (claims.length === 0) {
    return `No claim in the graph contains “${text.trim()}”. Index the project after a citation check, or quote a sentence that contains a citation.`;
  }
  const lines: string[] = [];
  for (const claim of claims.slice(0, 4)) {
    lines.push(`Claim: ${claim.label}`);
    const supporters = memory.edges
      .filter((edge) => edge.type === "supports" && edge.target === claim.id && edge.source.startsWith("paper:"))
      .map((edge) => memory.nodes.find((node) => node.id === edge.source))
      .filter((node): node is MemoryNode => Boolean(node));
    if (supporters.length === 0) lines.push("  No paper node is linked as support.");
    for (const paper of supporters) {
      lines.push(`  Supported by ${paper.props.key} (${paper.props.status || "unchecked"}): ${paper.label}`);
    }
  }
  return lines.join("\n");
}

function memoryPath(projectId: string) {
  return path.join(dataDir(), "memory", `${projectId}.json`);
}

export function saveMemory(projectId: string, memory: ProjectMemory) {
  const file = memoryPath(projectId);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(memory, null, 2));
}

export function loadMemory(projectId: string): ProjectMemory {
  const file = memoryPath(projectId);
  if (!fs.existsSync(file)) return { nodes: [], edges: [] };
  return JSON.parse(fs.readFileSync(file, "utf8")) as ProjectMemory;
}

export function rememberCitationReport(
  projectId: string,
  entries: BibEntry[],
  texFiles: { path: string; content: string }[],
  report: CitationReport,
) {
  const verification = Object.fromEntries(
    report.items.map((item) => [item.key, { status: item.status, detail: item.detail }]),
  );
  const memory = buildMemory({ entries, texFiles, verification });
  saveMemory(projectId, memory);
  return memory;
}
