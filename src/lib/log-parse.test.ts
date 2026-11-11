import { describe, expect, it } from "vitest";
import { parseCompileLog } from "@/lib/log-parse";

describe("compile log parsing", () => {
  it("reads Tectonic file:line errors and classic TeX errors", () => {
    const log = [
      "note: Running TeX ...",
      "error: sections/practice.tex:18: Undefined control sequence",
      "(./sections/introduction.tex",
      "! Missing $ inserted.",
      "<inserted text>",
      "l.12 a_b",
      "warning: main.tex:4: Underfull \\hbox (badness 10000)",
    ].join("\n");

    const diagnostics = parseCompileLog(log);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          file: "sections/practice.tex",
          line: 18,
          message: "Undefined control sequence",
        }),
        expect.objectContaining({
          severity: "error",
          file: "sections/introduction.tex",
          line: 12,
          message: "Missing $ inserted.",
        }),
        expect.objectContaining({
          severity: "warning",
          file: "main.tex",
          line: 4,
        }),
      ]),
    );
  });
});
