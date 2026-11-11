import { describe, expect, it } from "vitest";
import { applyPatchSequence, previewPatch } from "@/lib/patches";

const source = "\\section{Intro}\n\nLine breaking is an old problem.\n";

describe("patch application", () => {
  it("replaces a unique hunk and renders a diff", () => {
    const result = previewPatch(source, {
      path: "sections/introduction.tex",
      hunks: [{ search: "an old problem", replace: "a solved problem" }],
    });
    expect(result.next).toContain("a solved problem");
    expect(result.diff).toContain("-Line breaking is an old problem.");
    expect(result.diff).toContain("+Line breaking is a solved problem.");
  });

  it("rejects a missing or ambiguous search", () => {
    expect(() =>
      previewPatch(source, {
        path: "a.tex",
        hunks: [{ search: "not in the file", replace: "x" }],
      }),
    ).toThrow(/not found/i);
    const repeated = "alpha\nalpha\n";
    expect(() =>
      previewPatch(repeated, {
        path: "a.tex",
        hunks: [{ search: "alpha", replace: "beta" }],
      }),
    ).toThrow(/2 places/);
    const all = previewPatch(repeated, {
      path: "a.tex",
      hunks: [{ search: "alpha", replace: "beta", replaceAll: true }],
    });
    expect(all.next).toBe("beta\nbeta\n");
  });

  it("creates a new file and refuses traversal", () => {
    const created = previewPatch(null, {
      path: "sections/notes.tex",
      newFile: true,
      content: "\\section{Notes}\n",
    });
    expect(created.next).toContain("\\section{Notes}");
    expect(() =>
      previewPatch(null, { path: "../secret.tex", newFile: true, content: "nope" }),
    ).toThrow(/escapes|invalid/i);
  });

  it("applies sequential hunks against the updated text", () => {
    const applied = applyPatchSequence(
      () => "\\begin{document}\nHello.\n\\end{document}\n",
      [
        {
          path: "main.tex",
          hunks: [{ search: "Hello.", replace: "Hello, world." }],
        },
        {
          path: "main.tex",
          hunks: [{ search: "Hello, world.", replace: "Hello, Lumina." }],
        },
      ],
    );
    expect(applied.at(-1)?.next).toContain("Hello, Lumina.");
  });
});
