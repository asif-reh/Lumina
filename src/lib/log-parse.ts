import type { LogDiagnostic } from "@/lib/types";

function cleanFile(raw: string): string {
  let file = raw.trim().replaceAll("\\", "/");
  file = file.replace(/^\.\//, "");
  const marker = "/files/";
  const idx = file.lastIndexOf(marker);
  if (idx >= 0) file = file.slice(idx + marker.length);
  return file;
}

function dedupe(items: LogDiagnostic[]): LogDiagnostic[] {
  const seen = new Set<string>();
  const out: LogDiagnostic[] = [];
  for (const item of items) {
    const key = `${item.severity}|${item.file ?? ""}|${item.line ?? ""}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function parseCompileLog(log: string): LogDiagnostic[] {
  const lines = log.split(/\r?\n/);
  const diagnostics: LogDiagnostic[] = [];
  let currentFile: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    for (const match of line.matchAll(/\(\.\/([^()\s]+\.(?:tex|ltx|sty|cls|bib))/g)) {
      currentFile = match[1];
    }

    const tectonic = line.match(/^(error|warning):\s+(.+?):(\d+):\s*(.*)$/i);
    if (tectonic) {
      const file = cleanFile(tectonic[2]);
      if (!file.includes(" ")) {
        diagnostics.push({
          severity: tectonic[1].toLowerCase() === "error" ? "error" : "warning",
          file,
          line: Number(tectonic[3]),
          message: tectonic[4]?.trim() || tectonic[1],
        });
        continue;
      }
    }

    if (line.startsWith("! ")) {
      const message = line.slice(2).trim();
      let lineNo: number | undefined;
      const file = currentFile;
      for (let j = i; j < Math.min(lines.length, i + 8); j += 1) {
        const located = (lines[j] ?? "").match(/^l\.(\d+)\s/);
        if (located) {
          lineNo = Number(located[1]);
          break;
        }
      }
      diagnostics.push({
        severity: "error",
        file: file ? cleanFile(file) : undefined,
        line: lineNo,
        message,
      });
    }
  }

  const located = new Set(
    diagnostics
      .filter((item) => item.file && item.line)
      .map((item) => `${item.line}|${item.message.toLowerCase()}`),
  );
  const withoutEchoes = diagnostics.filter((item) => {
    if (item.file || !item.line) return true;
    return !located.has(`${item.line}|${item.message.toLowerCase()}`);
  });
  return dedupe(withoutEchoes);
}
