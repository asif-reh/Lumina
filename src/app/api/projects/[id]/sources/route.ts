import { credentialsFromRequest } from "@/lib/intelligence/credentials";
import { ingestProject } from "@/lib/intelligence/ingest";
import { listTextFiles, writeTextFile } from "@/lib/projects";
import type { SourceProposal } from "@/lib/types";
import { fail, jsonError, jsonOk } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      proposal?: SourceProposal;
      destination?: "bib" | "note";
    };
    const proposal = body.proposal;
    if (!proposal?.title) return jsonError(400, "invalid_body", "Accept a source that has a title.");
    if (body.destination === "note") {
      const slug = proposal.id.replace(/[^a-zA-Z0-9_-]/g, "") || "source";
      const markdown = `# ${proposal.title}\n\n${proposal.authors ?? ""}\n\n${proposal.abstract ?? ""}\n\n${proposal.markdown ?? ""}\n\nSource: ${proposal.url ?? ""}\n`;
      writeTextFile(id, `sources/${slug}.md`, markdown);
    } else {
      if (!proposal.bibtex?.trim()) {
        return jsonError(400, "no_bibtex", "That source has no BibTeX yet. Save it as a note instead.");
      }
      const bib = listTextFiles(id).find((file) => file.path.endsWith(".bib"));
      const path = bib?.path ?? "refs.bib";
      const current = bib?.content ?? "";
      writeTextFile(id, path, `${current.trim()}\n\n${proposal.bibtex.trim()}\n`);
    }
    const ingested = await ingestProject(id, credentialsFromRequest(request));
    return jsonOk({ saved: true, ingested });
  } catch (error) {
    return fail(error);
  }
}
