import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { LocalVectorStore, cosineSimilarity, rankChunks, type VectorChunk } from "@/lib/intelligence/vector";

describe("vector search", () => {
  it("ranks a matching chunk above an unrelated one", () => {
    const chunks: VectorChunk[] = [
      { id: "a", projectId: "p", source: "a.tex", text: "fair principles", embedding: [1, 0] },
      { id: "b", projectId: "p", source: "b.tex", text: "unrelated", embedding: [0, 1] },
    ];
    const ranked = rankChunks(chunks, [0.9, 0.1], 2);
    expect(ranked[0]?.source).toBe("a.tex");
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("upserts and queries a local index", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-index-"));
    const store = new LocalVectorStore(root);
    await store.upsert("demo", [
      { id: "1", projectId: "demo", source: "main.tex", text: "compile locally", embedding: [1, 0, 0] },
      { id: "2", projectId: "demo", source: "other.tex", text: "something else", embedding: [0, 1, 0] },
    ]);
    await store.upsert("demo", [
      { id: "1", projectId: "demo", source: "main.tex", text: "compile locally again", embedding: [1, 0, 0] },
    ]);
    expect(await store.count("demo")).toBe(2);
    const hits = await store.query("demo", [1, 0, 0], 1);
    expect(hits[0]?.text).toContain("again");
  });
});
