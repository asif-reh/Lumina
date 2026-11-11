import type { Credentials } from "@/lib/intelligence/credentials";
import { embedTexts } from "@/lib/intelligence/embeddings";
import { queryVectors } from "@/lib/intelligence/vector";

export async function retrieveProject(projectId: string, query: string, credentials: Credentials): Promise<string> {
  if (!credentials.openaiKey) {
    return "Retrieval needs an OpenAI API key for embeddings. Add one in Settings, then use Index project. You can still read files directly.";
  }
  const [embedding] = await embedTexts(credentials.openaiKey, [query]);
  if (!embedding) return "The embedding request returned nothing.";
  const pinecone =
    credentials.pineconeKey && credentials.pineconeHost
      ? { key: credentials.pineconeKey, host: credentials.pineconeHost }
      : undefined;
  const { hits, backend } = await queryVectors(projectId, embedding, 5, pinecone);
  if (hits.length === 0) {
    return `The ${backend} index has no chunks for this project yet. Use Index project after saving sources.`;
  }
  return hits
    .map((hit, index) => `(${index + 1}) ${hit.source} [${hit.score.toFixed(2)}]\n${hit.text.slice(0, 700)}`)
    .join("\n\n");
}
