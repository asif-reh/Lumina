import { describe, expect, it } from "vitest";
import { buildMemory, queryMemory } from "@/lib/intelligence/memory";
import type { BibEntry } from "@/lib/bib";

const entries: BibEntry[] = [
  {
    type: "article",
    key: "fair",
    fields: {
      title: "The FAIR Guiding Principles",
      author: "Wilkinson, Mark D. and Dumontier, Michel",
      year: "2016",
      doi: "10.1038/sdata.2016.18",
    },
  },
  {
    type: "misc",
    key: "madeup",
    fields: { title: "Not a real paper", author: "Nobody", year: "2099" },
  },
];

const tex = [
  {
    path: "main.tex",
    content:
      "The FAIR principles ask that data be reusable \\cite{fair}. A second sentence cites nothing. The invented row is \\cite{madeup} and should stay unverified.",
  },
];

describe("project graph memory", () => {
  const memory = buildMemory({
    entries,
    texFiles: tex,
    verification: {
      fair: { status: "verified", detail: "DOI agrees." },
      madeup: { status: "unverified", detail: "No match." },
    },
  });

  it("links authors, citations, claims, and evidence", () => {
    expect(memory.nodes.some((node) => node.type === "author" && node.label.includes("Wilkinson"))).toBe(true);
    expect(memory.edges.some((edge) => edge.type === "cites" && edge.target === "paper:fair")).toBe(true);
    expect(memory.nodes.some((node) => node.type === "claim")).toBe(true);
    expect(memory.edges.some((edge) => edge.type === "evidences")).toBe(true);
  });

  it("lists cited papers that are not verified", () => {
    const answer = queryMemory(memory, "unverified");
    expect(answer).toContain("madeup");
    expect(answer).not.toContain("fair:");
  });

  it("answers what supports a claim phrase", () => {
    const answer = queryMemory(memory, "supports", "FAIR principles");
    expect(answer).toContain("fair");
    expect(answer.toLowerCase()).toContain("verified");
  });
});
