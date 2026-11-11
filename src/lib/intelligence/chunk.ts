import { Document, SentenceSplitter } from "llamaindex";

export type TextChunk = {
  id: string;
  source: string;
  text: string;
};

/**
 * LlamaIndex owns splitting. Chunk ids stay stable for a source so re-indexing
 * replaces the same vectors.
 */
export function chunkText(source: string, text: string): TextChunk[] {
  const splitter = new SentenceSplitter({ chunkSize: 800, chunkOverlap: 80 });
  const document = new Document({ text, metadata: { source } });
  const nodes = splitter.getNodesFromDocuments([document]);
  return nodes
    .map((node, index) => ({
      id: `${source}#${index}`,
      source,
      text: node.getContent(),
    }))
    .filter((chunk) => chunk.text.trim().length > 0);
}
