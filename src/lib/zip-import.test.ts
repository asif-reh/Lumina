import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { planZipImport } from "@/lib/zip-import";

function zip(files: Record<string, string>) {
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])));
}

const article = "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n";

describe("ZIP import", () => {
  it("keeps a manuscript, drops conversation JSON, and chooses main.tex", () => {
    const plan = planZipImport(
      zip({
        "main.tex": article,
        "sections/intro.tex": "Intro",
        "refs.bib": "@article{a, title={Real}, year={2020}}",
        "figures/plot.csv": "x,y\n1,2\n",
        "data/results.json": JSON.stringify({ values: [1, 2, 3] }),
        "conversations/thread.json": JSON.stringify({
          messages: [{ role: "user", content: "rewrite the abstract" }],
        }),
        "chat-export.json": JSON.stringify([{ role: "assistant", content: "sure" }]),
        "__MACOSX/._main.tex": "junk",
        "main.aux": "\\relax",
        "../escape.tex": article,
      }),
    );

    const paths = plan.files.map((file) => file.path);
    expect(paths).toContain("main.tex");
    expect(paths).toContain("sections/intro.tex");
    expect(paths).toContain("refs.bib");
    expect(paths).toContain("figures/plot.csv");
    expect(paths).toContain("data/results.json");
    expect(paths.some((path) => path.includes("conversation") || path.endsWith("chat-export.json"))).toBe(false);
    expect(paths.some((path) => path.includes("MACOSX") || path.includes("escape") || path.endsWith(".aux"))).toBe(false);
    expect(plan.mainFile).toBe("main.tex");
  });

  it("unwraps a single root folder and honors a TEX root comment", () => {
    const plan = planZipImport(
      zip({
        "Paper/notes.tex": "% !TEX root = manuscript.tex\nJust notes.\n",
        "Paper/manuscript.tex": article,
        "Paper/extra.tex": "\\documentclass{article}\n\\begin{document}Other\\end{document}\n",
      }),
    );
    expect(plan.files.map((file) => file.path).sort()).toEqual([
      "extra.tex",
      "manuscript.tex",
      "notes.tex",
    ]);
    expect(plan.mainFile).toBe("manuscript.tex");
  });

  it("rejects an archive with no LaTeX", () => {
    expect(() => planZipImport(zip({ "readme.md": "hello" }))).toThrow(/No LaTeX sources/);
  });
});
