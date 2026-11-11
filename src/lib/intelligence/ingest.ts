import { parseBibTeX } from "@/lib/bib";
import type { Credentials } from "@/lib/intelligence/credentials";
import { chunkText } from "@/lib/intelligence/chunk";
import { embedTexts } from "@/lib/intelligence/embeddings";
import { buildMemory, queryMemory, saveMemory } from "@/lib/intelligence/memory";
import { extractPdf } from "@/lib/intelligence/pdf-extract";
import { upsertVectors, type VectorBackend, type VectorChunk } from "@/lib/intelligence/vector";
import { fileTree, listTextFiles, readFileBytes } from "@/lib/projects";
import type { FileNode } from "@/lib/types";

const MAX_CHUNKS = 80;

export type IngestResult = {
  chunks: number;
  backend: VectorBackend | "none";
  graph: string;
  notes: string[];
};

export async function ingestProject(projectId: string, credentials: Credentials): Promise<IngestResult> {
  const notes: string[] = [];
  const files = listTextFiles(projectId);
  const tex = files.filter((file) => /\.(tex|ltx|bib|md)$/i.test(file.path));
  const chunks = tex.flatMap((file) => chunkText(file.path, file.content)).slice(0, MAX_CHUNKS);
  if (tex.flatMap((file) => chunkText(file.path, file.content)).length > MAX_CHUNKS) {
    notes.push(`Indexed the first ${MAX_CHUNKS} chunks.`);
  }

  const pdfs: string[] = [];
  const walk = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.type === "dir" && node.children) walk(node.children);
      else if (node.path.toLowerCase().endsWith(".pdf")) pdfs.push(node.path);
    }
  };
  walk(fileTree(projectId));
  for (const pdfPath of pdfs.slice(0, 4)) {
    try {
      const extracted = await extractPdf(readFileBytes(projectId, pdfPath), pdfPath, credentials.llamaCloudKey);
      if (extracted.note) notes.push(`${pdfPath}: ${extracted.note}`);
      chunks.push(...chunkText(pdfPath, extracted.text).slice(0, 8));
    } catch (error) {
      notes.push(`${pdfPath}: ${error instanceof Error ? error.message : "Could not read PDF."}`);
    }
  }

  let backend: IngestResult["backend"] = "none";
  if (!credentials.openaiKey) {
    notes.push("No OpenAI key, so the vector index was not updated. The citation graph was still rebuilt.");
  } else if (chunks.length === 0) {
    notes.push("Nothing to embed yet.");
  } else {
    const vectors = await embedTexts(credentials.openaiKey, chunks.map((chunk) => chunk.text));
    const records: VectorChunk[] = chunks.map((chunk, index) => ({
      id: `${projectId}:${chunk.id}`,
      projectId,
      source: chunk.source,
      text: chunk.text,
      embedding: vectors[index] ?? [],
    }));
    const pinecone =
      credentials.pineconeKey && credentials.pineconeHost
        ? { key: credentials.pineconeKey, host: credentials.pineconeHost }
        : undefined;
    backend = await upsertVectors(projectId, records, pinecone);
    notes.push(
      backend === "pgvector"
        ? "Stored embeddings in Postgres pgvector."
        : backend === "pinecone"
          ? "Stored embeddings in Pinecone."
          : "Postgres is not configured, so embeddings are in the local index under data/indexes. Set DATABASE_URL to use pgvector.",
    );
  }

  const entries = files.filter((file) => file.path.endsWith(".bib")).flatMap((file) => parseBibTeX(file.content));
  const memory = buildMemory({
    entries,
    texFiles: files.filter((file) => /\.(tex|ltx)$/i.test(file.path)),
  });
  saveMemory(projectId, memory);
  return {
    chunks: backend === "none" ? 0 : chunks.length,
    backend,
    graph: queryMemory(memory, "summary"),
    notes,
  };
}
