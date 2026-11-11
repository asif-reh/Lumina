import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/intelligence/chunk";
import { pagesFromSearch, proposalFromExtract } from "@/lib/intelligence/firecrawl";

describe("LlamaIndex chunking", () => {
  it("splits a long manuscript into more than one chunk", () => {
    const paragraph = "The manuscript stays on a machine you control and compiles with a local engine. ";
    const chunks = chunkText("main.tex", paragraph.repeat(80));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.source).toBe("main.tex");
    expect(chunks[0]?.text.length).toBeGreaterThan(20);
  });
});

describe("Firecrawl proposals", () => {
  it("maps search rows and refuses to invent a bibliography entry without a title", () => {
    const pages = pagesFromSearch({
      data: [{ url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", description: "Abstract page" }],
    });
    expect(pages[0]?.url).toContain("arxiv.org");
    const proposal = proposalFromExtract("https://example.edu/lab", {}, "page text");
    expect(proposal.bibtex).toBeUndefined();
    expect(proposal.title).toBe("https://example.edu/lab");
  });
});
