import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBibTeX } from "@/lib/bib";
import { createProject } from "@/lib/projects";
import { chatKey, type Credentials } from "@/lib/intelligence/credentials";
import { firecrawlSearch, proposalFromExtract } from "@/lib/intelligence/firecrawl";
import { ingestProject } from "@/lib/intelligence/ingest";
import { buildMemory, queryMemory, rememberCitationReport } from "@/lib/intelligence/memory";
import { observe } from "@/lib/intelligence/observe";
import { retrieveProject } from "@/lib/intelligence/retrieve";
import type { CitationReport } from "@/lib/types";

const emptyCredentials: Credentials = {
  openaiKey: "",
  openrouterKey: "",
  provider: "openai",
  model: "gpt-4.1",
  firecrawlKey: "",
  langfusePublicKey: "",
  langfuseSecretKey: "",
  langfuseHost: "",
  llamaCloudKey: "",
  pineconeKey: "",
  pineconeHost: "",
  zoteroKey: "",
  zoteroUserId: "",
  semanticScholarKey: "",
};

const previousData = process.env.LUMINA_DATA_DIR;
const previousDb = process.env.DATABASE_URL;

afterEach(() => {
  if (previousData === undefined) delete process.env.LUMINA_DATA_DIR;
  else process.env.LUMINA_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDb;
});

describe("missing keys", () => {
  it("keeps chat, retrieval, Firecrawl, and Langfuse from calling out", async () => {
    expect(chatKey(emptyCredentials)).toBeNull();
    expect(observe(emptyCredentials).enabled).toBe(false);
    await expect(firecrawlSearch("", "fair principles")).resolves.toMatch(/Firecrawl API key/);
    await expect(retrieveProject("demo", "compile", emptyCredentials)).resolves.toMatch(/OpenAI API key/);
  });
});

describe("citation results update the graph", () => {
  it("marks a cited unmatched entry unverified after a report is remembered", () => {
    process.env.LUMINA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-memory-"));
    const entries = parseBibTeX(`
      @article{fair, title = {The FAIR Guiding Principles}, author = {Wilkinson, Mark}, year = {2016}}
      @misc{madeup, title = {Not a real paper}, author = {Nobody}, year = {2099}}
    `);
    const tex = [{ path: "main.tex", content: "See \\cite{fair} and \\cite{madeup}." }];
    const report = {
      checkedAt: new Date().toISOString(),
      warnings: [],
      truncated: false,
      counts: { verified: 1, mismatch: 0, unverified: 1, missing: 0, lookup_failed: 0 },
      items: [
        {
          key: "fair",
          status: "verified",
          detail: "DOI agrees.",
          inBibliography: true,
          cited: true,
        },
        {
          key: "madeup",
          status: "unverified",
          detail: "No confident match.",
          inBibliography: true,
          cited: true,
        },
      ],
    } satisfies CitationReport;
    const memory = rememberCitationReport("graph-demo", entries, tex, report);
    expect(memory.nodes.find((node) => node.props.key === "madeup")?.props.status).toBe("unverified");
    expect(queryMemory(memory, "unverified")).toContain("madeup");
    expect(queryMemory(memory, "unverified")).not.toMatch(/^fair:/m);
    expect(buildMemory({ entries, texFiles: tex }).nodes.some((node) => node.type === "paper")).toBe(true);
  });
});

describe("intake without an embedding key", () => {
  it("rebuilds graph memory and skips the vector index", async () => {
    process.env.LUMINA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-intake-"));
    delete process.env.DATABASE_URL;
    const project = createProject("Intake note", { seed: "blank" });
    const proposal = proposalFromExtract(
      "https://arxiv.org/abs/1706.03762",
      { title: "Attention Is All You Need", authors: "Vaswani, Ashish", year: "2017" },
      "A paper page.",
    );
    expect(proposal.bibtex).toContain("Attention Is All You Need");
    const result = await ingestProject(project.id, emptyCredentials);
    expect(result.backend).toBe("none");
    expect(result.chunks).toBe(0);
    expect(result.notes.join(" ")).toMatch(/OpenAI key/);
    expect(result.graph).toMatch(/manuscript/);
  });
});
