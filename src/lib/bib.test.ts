import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { entryArxivId, entryDoi, parseBibTeX } from "@/lib/bib";
import { extractBibliographyRefs, extractCitationKeys } from "@/lib/cite-scan";
import { judgeDoiHit, judgeSearchHit, titleSimilarity } from "@/lib/citation-judge";

describe("BibTeX parsing", () => {
  it("parses the sample bibliography, including nested braces and arXiv ids", () => {
    const entries = parseBibTeX(readFileSync("sample-project/refs.bib", "utf8"));
    const byKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]));

    expect(entries.map((entry) => entry.key)).toEqual([
      "knuth1981breaking",
      "lamport1994latex",
      "wilkinson2016fair",
      "vaswani2017attention",
      "luminaDemoUnverifiable2099",
    ]);
    expect(entryDoi(byKey.wilkinson2016fair)).toBe("10.1038/sdata.2016.18");
    expect(byKey.wilkinson2016fair.fields.title).toContain("FAIR");
    expect(entryArxivId(byKey.vaswani2017attention)).toBe("1706.03762");
    expect(byKey.lamport1994latex.fields.title).toContain("\\LaTeX");
    expect(byKey.vaswani2017attention.fields.author).toContain("Polosukhin");
  });

  it("reads quoted fields and concatenation", () => {
    const [entry] = parseBibTeX(`
      @book{quoted,
        title = "A real " # "title",
        year = 1994
      }
    `);
    expect(entry?.fields.title).toBe("A real title");
    expect(entry?.fields.year).toBe("1994");
  });
});

describe("citation commands", () => {
  it("collects keys and bibliography resources from the sample", () => {
    const intro = readFileSync("sample-project/sections/introduction.tex", "utf8");
    const practice = readFileSync("sample-project/sections/practice.tex", "utf8");
    const main = readFileSync("sample-project/main.tex", "utf8");
    const keys = [...extractCitationKeys(intro), ...extractCitationKeys(practice)];
    expect(keys).toEqual([
      "knuth1981breaking",
      "lamport1994latex",
      "wilkinson2016fair",
      "vaswani2017attention",
    ]);
    expect(extractBibliographyRefs(main)).toEqual(["refs"]);
  });

  it("splits multi-key cite commands", () => {
    expect(extractCitationKeys("See \\citep[see][ch.~2]{alpha, beta}.")).toEqual(["alpha", "beta"]);
  });
});

describe("citation matching", () => {
  const fair = {
    title: "The FAIR Guiding Principles for scientific data management and stewardship",
    authors: ["Mark D. Wilkinson", "Michel Dumontier"],
    year: "2016",
    doi: "10.1038/sdata.2016.18",
    source: "crossref" as const,
  };

  it("treats an agreeing DOI record as verified and a swapped title as a mismatch", () => {
    expect(judgeDoiHit(fair.title, fair)).toBe("verified");
    expect(
      judgeDoiHit("A completely different paper about underwater basket weaving", fair),
    ).toBe("mismatch");
  });

  it("does not verify a partial or invented title from search", () => {
    expect(titleSimilarity("{\\LaTeX}: A Document Preparation System", "LaTeX: A Document Preparation System")).toBeGreaterThan(0.8);
    expect(
      judgeSearchHit(
        { title: fair.title, author: "Wilkinson, Mark D.", year: "2016" },
        fair,
      ),
    ).toBe("verified");
    expect(
      judgeSearchHit(
        {
          title: "Intentionally unverifiable fixture for the citation checker",
          author: "Lumina Sample",
          year: "2099",
        },
        fair,
      ),
    ).toBe("weak");
    expect(
      judgeSearchHit(
        { title: "The FAIR Guiding Principles", author: "Someone Else", year: "1990" },
        fair,
      ),
    ).toBe("weak");
  });
});
