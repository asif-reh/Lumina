import fs from "fs";
import path from "path";
import { dataDir, ensureDir } from "@/lib/paths";

export type VectorChunk = {
  id: string;
  projectId: string;
  source: string;
  text: string;
  embedding: number[];
};

export type VectorHit = {
  source: string;
  text: string;
  score: number;
};

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function rankChunks(chunks: VectorChunk[], query: number[], limit: number): VectorHit[] {
  return chunks
    .map((chunk) => ({
      source: chunk.source,
      text: chunk.text,
      score: cosineSimilarity(chunk.embedding, query),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

type StoreFile = { chunks: VectorChunk[] };

export class LocalVectorStore {
  constructor(private readonly root: string) {}

  private file(projectId: string) {
    return path.join(this.root, `${projectId}.json`);
  }

  async upsert(projectId: string, chunks: VectorChunk[]) {
    ensureDir(this.root);
    const current = await this.read(projectId);
    const byId = new Map(current.map((chunk) => [chunk.id, chunk]));
    for (const chunk of chunks) byId.set(chunk.id, chunk);
    const next: StoreFile = { chunks: [...byId.values()] };
    fs.writeFileSync(this.file(projectId), JSON.stringify(next));
  }

  async query(projectId: string, embedding: number[], limit = 6): Promise<VectorHit[]> {
    return rankChunks(await this.read(projectId), embedding, limit);
  }

  async count(projectId: string): Promise<number> {
    return (await this.read(projectId)).length;
  }

  private async read(projectId: string): Promise<VectorChunk[]> {
    const file = this.file(projectId);
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoreFile;
    return parsed.chunks ?? [];
  }
}

export type VectorBackend = "pgvector" | "pinecone" | "local";

export function vectorBackend(): VectorBackend {
  if (process.env.DATABASE_URL?.trim()) return "pgvector";
  return "local";
}

export function localIndexDir(): string {
  return path.join(dataDir(), "indexes");
}

export async function upsertVectors(
  projectId: string,
  chunks: VectorChunk[],
  pinecone?: { key: string; host: string },
): Promise<VectorBackend> {
  if (pinecone?.key && pinecone.host) {
    await pineconeUpsert(pinecone, projectId, chunks);
    return "pinecone";
  }
  if (process.env.DATABASE_URL?.trim()) {
    await pgUpsert(projectId, chunks);
    return "pgvector";
  }
  await new LocalVectorStore(localIndexDir()).upsert(projectId, chunks);
  return "local";
}

export async function queryVectors(
  projectId: string,
  embedding: number[],
  limit: number,
  pinecone?: { key: string; host: string },
): Promise<{ hits: VectorHit[]; backend: VectorBackend }> {
  if (pinecone?.key && pinecone.host) {
    return { hits: await pineconeQuery(pinecone, projectId, embedding, limit), backend: "pinecone" };
  }
  if (process.env.DATABASE_URL?.trim()) {
    return { hits: await pgQuery(projectId, embedding, limit), backend: "pgvector" };
  }
  return {
    hits: await new LocalVectorStore(localIndexDir()).query(projectId, embedding, limit),
    backend: "local",
  };
}

async function pgClient() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  await client.query(`
    CREATE TABLE IF NOT EXISTS lumina_chunks (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      source text NOT NULL,
      text_content text NOT NULL,
      embedding vector(1536) NOT NULL
    )
  `);
  return client;
}

async function pgUpsert(projectId: string, chunks: VectorChunk[]) {
  const client = await pgClient();
  try {
    for (const chunk of chunks) {
      const literal = `[${chunk.embedding.join(",")}]`;
      await client.query(
        `INSERT INTO lumina_chunks (id, project_id, source, text_content, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (id) DO UPDATE SET text_content = EXCLUDED.text_content, embedding = EXCLUDED.embedding, source = EXCLUDED.source`,
        [chunk.id, projectId, chunk.source, chunk.text, literal],
      );
    }
  } finally {
    await client.end();
  }
}

async function pgQuery(projectId: string, embedding: number[], limit: number): Promise<VectorHit[]> {
  const client = await pgClient();
  try {
    const literal = `[${embedding.join(",")}]`;
    const result = await client.query<{ source: string; text_content: string; score: number }>(
      `SELECT source, text_content, 1 - (embedding <=> $2::vector) AS score
       FROM lumina_chunks
       WHERE project_id = $1
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [projectId, literal, limit],
    );
    return result.rows.map((row) => ({ source: row.source, text: row.text_content, score: Number(row.score) }));
  } finally {
    await client.end();
  }
}

async function pineconeUpsert(pinecone: { key: string; host: string }, projectId: string, chunks: VectorChunk[]) {
  const host = pinecone.host.replace(/\/$/, "");
  const response = await fetch(`${host}/vectors/upsert`, {
    method: "POST",
    headers: {
      "Api-Key": pinecone.key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      namespace: projectId,
      vectors: chunks.map((chunk) => ({
        id: chunk.id,
        values: chunk.embedding,
        metadata: { source: chunk.source, text: chunk.text.slice(0, 1000) },
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(`Pinecone upsert failed (${response.status}). Check the index host and key in Settings.`);
  }
}

async function pineconeQuery(
  pinecone: { key: string; host: string },
  projectId: string,
  embedding: number[],
  limit: number,
): Promise<VectorHit[]> {
  const host = pinecone.host.replace(/\/$/, "");
  const response = await fetch(`${host}/query`, {
    method: "POST",
    headers: {
      "Api-Key": pinecone.key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      namespace: projectId,
      vector: embedding,
      topK: limit,
      includeMetadata: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Pinecone query failed (${response.status}).`);
  }
  const body = (await response.json()) as {
    matches?: { score?: number; metadata?: { source?: string; text?: string } }[];
  };
  return (body.matches ?? []).map((match) => ({
    source: match.metadata?.source ?? "pinecone",
    text: match.metadata?.text ?? "",
    score: match.score ?? 0,
  }));
}
