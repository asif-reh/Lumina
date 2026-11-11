import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

export async function embedTexts(apiKey: string, values: string[]): Promise<number[][]> {
  if (!apiKey) {
    throw new Error("Embeddings need an OpenAI API key, even when chat uses OpenRouter. Add one in Settings.");
  }
  if (values.length === 0) return [];
  const provider = createOpenAI({ apiKey });
  const vectors: number[][] = [];
  for (let index = 0; index < values.length; index += 16) {
    const batch = values.slice(index, index + 16);
    const result = await embedMany({
      model: provider.embedding("text-embedding-3-small"),
      values: batch,
    });
    vectors.push(...result.embeddings);
  }
  return vectors;
}
