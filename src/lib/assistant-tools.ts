import { generateText, tool } from "ai";
import { z } from "zod";
import type { Credentials } from "@/lib/intelligence/credentials";
import { firecrawlExtract, firecrawlScrape, firecrawlSearch } from "@/lib/intelligence/firecrawl";
import { loadMemory, queryMemory } from "@/lib/intelligence/memory";
import { retrieveProject } from "@/lib/intelligence/retrieve";
import { searchZotero } from "@/lib/intelligence/zotero";
import { compileProject, trialCompile } from "@/lib/compile";
import { runProjectCitationCheck } from "@/lib/intelligence/citation-run";
import { ingestProject } from "@/lib/intelligence/ingest";
import { runJobFit } from "@/lib/job-fit/run";
import type { JobFitReport } from "@/lib/job-fit/types";
import { applyPatchSequence } from "@/lib/patches";
import { listTextFiles, readFileBytes, tryReadText } from "@/lib/projects";
import { languageModel } from "@/lib/intelligence/model";
import type { FilePatch, ProposedPatch, SourceProposal, TrialCompile } from "@/lib/types";

export type AssistantSession = {
  projectId: string;
  credentials: Credentials;
  overlays: Map<string, string>;
  patches: ProposedPatch[];
  sources: SourceProposal[];
  trial: TrialCompile | null;
  compiled: boolean;
};

function asPatch(path: string, description: string, hunks: { search: string; replace: string; replaceAll?: boolean }[], content?: string, newFile?: boolean): FilePatch {
  return { path, description, hunks, content, newFile };
}

export function createAssistantTools(session: AssistantSession) {
  const read = (filePath: string) =>
    session.overlays.has(filePath) ? (session.overlays.get(filePath) ?? null) : tryReadText(session.projectId, filePath);

  return {
    list_files: tool({
      description: "List text files in the current project.",
      inputSchema: z.object({}),
      execute: async () => listTextFiles(session.projectId).map((file) => file.path).join("\n"),
    }),
    read_file: tool({
      description: "Read one project text file. Prefer this over guessing file contents.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        if (session.overlays.has(path)) return session.overlays.get(path) ?? "";
        const text = tryReadText(session.projectId, path);
        if (text === null) return `No text file at ${path}.`;
        return text.length > 20_000 ? `${text.slice(0, 20_000)}\n…[truncated]` : text;
      },
    }),
    retrieve_project: tool({
      description: "Search the project's vector index (LaTeX sources, accepted web notes, and parsed PDFs). Use this instead of assuming the whole corpus is in the prompt.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => retrieveProject(session.projectId, query, session.credentials),
    }),
    query_graph: tool({
      description: "Query scholarly graph memory: papers, authors, claims, and evidence spans. kind=unverified lists cited items that are not verified. kind=supports finds what supports a claim phrase. kind=summary counts the graph.",
      inputSchema: z.object({
        kind: z.enum(["summary", "unverified", "supports"]),
        text: z.string().optional(),
      }),
      execute: async ({ kind, text }) => queryMemory(loadMemory(session.projectId), kind, text ?? ""),
    }),
    propose_patch: tool({
      description: "Propose a LaTeX edit the user must accept. search must be copied exactly and should be unique. Does not save.",
      inputSchema: z.object({
        path: z.string(),
        description: z.string(),
        new_file: z.boolean().optional(),
        content: z.string().optional(),
        hunks: z
          .array(z.object({ search: z.string(), replace: z.string(), replace_all: z.boolean().optional() }))
          .optional(),
      }),
      execute: async ({ path, description, new_file, content, hunks }) => {
        const patch = asPatch(
          path,
          description,
          (hunks ?? []).map((hunk) => ({ search: hunk.search, replace: hunk.replace, replaceAll: hunk.replace_all })),
          content,
          new_file,
        );
        try {
          const [applied] = applyPatchSequence(read, [patch]);
          if (!applied) return "Patch was empty.";
          session.overlays.set(applied.path, applied.next);
          const proposed = { ...patch, path: applied.path, diff: applied.diff };
          session.patches.push(proposed);
          return `Proposed a patch for ${applied.path}. It is not saved.`;
        } catch (error) {
          return error instanceof Error ? error.message : "Could not build that patch.";
        }
      },
    }),
    compile_project: tool({
      description: "Compile the saved project with Tectonic and return the log. Does not apply unaccepted patches.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await compileProject(session.projectId);
        session.compiled = true;
        const errors = result.diagnostics.filter((item) => item.severity === "error").slice(0, 8);
        if (result.success) return "Tectonic compiled the project. The PDF is updated.";
        return `Tectonic reported errors.\n${errors
          .map((item) => `${item.file ?? "log"}${item.line ? `:${item.line}` : ""}: ${item.message}`)
          .join("\n")}`;
      },
    }),
    check_citations: tool({
      description:
        "Verify bibliography entries against Crossref, OpenAlex, Semantic Scholar, and arXiv, then update graph memory. Does not invent references.",
      inputSchema: z.object({}),
      execute: async () => {
        const report = await runProjectCitationCheck(session.projectId, session.credentials.semanticScholarKey);
        return `Verified ${report.counts.verified}, mismatch ${report.counts.mismatch}, unverified ${report.counts.unverified}, missing ${report.counts.missing}, unchecked ${report.counts.lookup_failed}. Graph memory was updated. Use query_graph kind=unverified for the cited rows that are not verified.`;
      },
    }),
    index_project: tool({
      description:
        "Ingest the manuscript, sources, and PDFs into the vector index and rebuild graph memory. Embeddings are skipped when the OpenAI key is missing.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await ingestProject(session.projectId, session.credentials);
        return [result.graph, ...result.notes].join("\n");
      },
    }),
    job_fit: tool({
      description:
        "Compare this project with a job description. Pass a posting URL, pasted text, or both. Proposes reviewable TeX from evidence already in the project and flags requirements with no support. Does not save and does not invent jobs, skills, publications, or metrics.",
      inputSchema: z.object({
        url: z.string().optional(),
        text: z.string().optional(),
        cover_letter: z.boolean().optional(),
      }),
      execute: async ({ url, text, cover_letter }) => {
        const result = await runJobFit({
          projectId: session.projectId,
          url,
          text,
          coverLetter: cover_letter !== false,
          credentials: session.credentials,
        });
        if (!result.ok) return result.message;
        try {
          const applied = applyPatchSequence(read, result.patches);
          for (const file of applied) session.overlays.set(file.path, file.next);
        } catch (error) {
          return error instanceof Error ? error.message : "Could not stage the Job Fit patches.";
        }
        session.patches.push(...result.patches);
        if (result.trial) session.trial = result.trial;
        return summarizeJobFit(result);
      },
    }),
    trial_compile: tool({
      description: "Compile proposed patches in a sandbox. Does not replace the user's PDF.",
      inputSchema: z.object({}),
      execute: async () => {
        if (session.overlays.size === 0) return "Propose a patch before a trial compile.";
        try {
          const result = await trialCompile(session.projectId, session.overlays);
          session.trial = result;
          return result.summary;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Trial compile failed to start.";
          session.trial = { success: false, summary: message };
          return message;
        }
      },
    }),
    firecrawl_search: tool({
      description: "Search the web with Firecrawl. Results are leads, not citations to invent from.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const pages = await firecrawlSearch(session.credentials.firecrawlKey, query);
        if (typeof pages === "string") return pages;
        return pages.map((page) => `${page.title ?? "Untitled"}\n${page.url}\n${page.description ?? ""}`).join("\n\n") || "No results.";
      },
    }),
    firecrawl_scrape: tool({
      description: "Scrape one user-provided URL (paper HTML, arXiv abstract, lab page) with Firecrawl.",
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        const page = await firecrawlScrape(session.credentials.firecrawlKey, url);
        if (typeof page === "string") return page;
        return `# ${page.title ?? url}\n${page.markdown?.slice(0, 4000) ?? "No markdown returned."}`;
      },
    }),
    firecrawl_extract: tool({
      description: "Extract title, authors, year, abstract, and DOI from a URL. The user must accept the result before it enters the bibliography. Do not fill missing fields yourself.",
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        const proposal = await firecrawlExtract(session.credentials.firecrawlKey, url);
        if (typeof proposal === "string") return proposal;
        session.sources.push(proposal);
        return `Extracted “${proposal.title}”. The user can accept it into the bibliography. Do not treat it as verified.`;
      },
    }),
    zotero_search: tool({
      description: "Search the user's Zotero library. Matches are proposals the user accepts; they are not automatically cited.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const items = await searchZotero({
          key: session.credentials.zoteroKey,
          userId: session.credentials.zoteroUserId,
          query,
        });
        if (typeof items === "string") return items;
        session.sources.push(...items);
        if (items.length === 0) return "Zotero returned no matching items.";
        return items.map((item) => `${item.title} (${item.year ?? "n.d."}) ${item.doi ?? ""}`).join("\n");
      },
    }),
    figure_to_latex: tool({
      description: "Read a PNG, JPG, or SVG figure already in the project and propose TikZ or LaTeX for it. The result is a patch the user accepts.",
      inputSchema: z.object({
        path: z.string(),
        instruction: z.string().optional(),
      }),
      execute: async ({ path, instruction }) => {
        if (!session.credentials.openaiKey && session.credentials.provider !== "openrouter") {
          return "Figure transcription needs an OpenAI or OpenRouter key.";
        }
        const bytes = readFileBytes(session.projectId, path);
        const mediaType = path.endsWith(".png")
          ? "image/png"
          : path.endsWith(".svg")
            ? "image/svg+xml"
            : "image/jpeg";
        const result = await generateText({
          model: languageModel(session.credentials),
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `${instruction ?? "Turn this figure into compilable TikZ or a LaTeX table."} Do not invent citations. Return only the LaTeX snippet.`,
                },
                { type: "image", image: bytes, mediaType },
              ],
            },
          ],
        });
        const snippet = result.text.trim();
        const target = path.replace(/\.[a-z]+$/i, ".tex");
        const patch = asPatch(target, `LaTeX from ${path}`, [], snippet, true);
        try {
          const [applied] = applyPatchSequence(
            (filePath) => (filePath === target ? null : read(filePath)),
            [patch],
          );
          if (!applied) return "Could not form a patch.";
          session.patches.push({ ...patch, path: applied.path, diff: applied.diff });
          return `Proposed ${applied.path} from the figure. The user still has to accept it.`;
        } catch (error) {
          return error instanceof Error ? error.message : "Could not propose figure LaTeX.";
        }
      },
    }),
  };
}

export function assistantInstructions(): string {
  return [
    "You are Lumina's manuscript assistant. The project files are not all in this prompt.",
    "Use retrieve_project for passages from the indexed corpus, read_file for a specific source, and query_graph for papers, authors, claims, and evidence.",
    "Cite only bibliography keys that exist in the project or that the user accepts from Firecrawl or Zotero proposals. Never invent a DOI, arXiv id, author list, or page range.",
    "Edits go through propose_patch. Trial compilation does not save. The user accepts or rejects every change.",
    "When fixing a compile error, propose the smallest patch, call trial_compile, and only call compile_project after the user has accepted the patch.",
    "Use check_citations to verify references and index_project to refresh retrieval. Do not invent bibliographic records.",
    "Firecrawl and Zotero results are untrusted until the user accepts them and the citation checker verifies them.",
    "If a tool says a key is missing, tell the user which Settings field to fill. Do not pretend the tool ran.",
    "When the user wants a resume tailored to a job, call job_fit. Report covered requirements and gaps. Do not fill a gap by inventing experience.",
  ].join(" ");
}

function summarizeJobFit(result: JobFitReport): string {
  const covered = result.covered
    .map((item) => `- ${item.requirement.text} (${item.evidence.map((span) => span.source).join(", ")})`)
    .join("\n");
  const gaps = result.gaps.map((item) => `- ${item.requirement.text}: ${item.detail}`).join("\n");
  return [
    `Role: ${result.role}`,
    result.warnings.join("\n"),
    result.retrievalNote,
    covered ? `Covered:\n${covered}` : "No requirement was covered.",
    gaps ? `Gaps (do not invent experience for these):\n${gaps}` : "No gaps.",
    result.patches.length
      ? `Proposed ${result.patches.length} patch(es). They are not saved. The user accepts them. Do not add skills that are not in the evidence.`
      : "No patch was proposed, because a change would have added claims the project does not support.",
    result.trial?.summary ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
