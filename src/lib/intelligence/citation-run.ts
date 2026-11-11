import { parseBibTeX } from "@/lib/bib";
import { extractBibliographyRefs, extractCitationKeys } from "@/lib/cite-scan";
import { buildCitationReport } from "@/lib/citations";
import { rememberCitationReport } from "@/lib/intelligence/memory";
import { listTextFiles } from "@/lib/projects";
import type { CitationReport } from "@/lib/types";

export async function runProjectCitationCheck(
  projectId: string,
  semanticScholarKey = "",
): Promise<CitationReport> {
  const files = listTextFiles(projectId);
  const tex = files.filter((file) => /\.(tex|ltx)$/i.test(file.path));
  const bib = files.filter((file) => file.path.toLowerCase().endsWith(".bib"));
  const entries = bib.flatMap((file) => parseBibTeX(file.content));
  const citedKeys = tex.flatMap((file) => extractCitationKeys(file.content));
  const referenced = new Set(tex.flatMap((file) => extractBibliographyRefs(file.content)));
  const present = new Set(bib.map((file) => file.path.split("/").pop()!.replace(/\.bib$/i, "")));
  const missingBibFiles = [...referenced].filter((name) => !present.has(name));
  const report = await buildCitationReport({
    entries,
    citedKeys,
    missingBibFiles,
    semanticScholarKey,
  });
  rememberCitationReport(projectId, entries, tex, report);
  return report;
}
