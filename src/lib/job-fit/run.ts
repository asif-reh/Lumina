import { trialCompile } from "@/lib/compile";
import type { Credentials } from "@/lib/intelligence/credentials";
import { loadMemory, queryMemory } from "@/lib/intelligence/memory";
import { retrieveProject } from "@/lib/intelligence/retrieve";
import { logEvent } from "@/lib/log";
import { applyPatchSequence } from "@/lib/patches";
import { listTextFiles, tryReadText } from "@/lib/projects";
import { groundRequirements, projectEvidence, spansFromGraph, spansFromRetrieval } from "@/lib/job-fit/ground";
import { loadJobPosting } from "@/lib/job-fit/ingest";
import { buildJobFitPatches } from "@/lib/job-fit/patches";
import { extractJobDescription } from "@/lib/job-fit/parse";
import type { EvidenceSpan, JobDescription, JobFitResult } from "@/lib/job-fit/types";
import type { FilePatch, ProposedPatch, TrialCompile } from "@/lib/types";

export type JobFitDeps = {
  extract: (text: string, credentials: Credentials) => Promise<JobDescription>;
  retrieve: (projectId: string, query: string, credentials: Credentials) => Promise<string>;
  readGraph: (projectId: string, phrase: string) => string;
  compileTrial: (projectId: string, overlays: Map<string, string>) => Promise<TrialCompile>;
};

const defaultDeps: JobFitDeps = {
  extract: extractJobDescription,
  retrieve: retrieveProject,
  readGraph: (projectId, phrase) => queryMemory(loadMemory(projectId), "supports", phrase),
  compileTrial: trialCompile,
};

function previewAll(
  read: (filePath: string) => string | null,
  patches: FilePatch[],
): { proposed: ProposedPatch[]; warnings: string[] } {
  const warnings: string[] = [];
  const proposed: ProposedPatch[] = [];
  const overlays = new Map<string, string | null>();
  const current = (filePath: string) => (overlays.has(filePath) ? overlays.get(filePath)! : read(filePath));
  for (const patch of patches) {
    try {
      const [applied] = applyPatchSequence(current, [patch]);
      if (!applied) continue;
      overlays.set(applied.path, applied.next);
      proposed.push({ ...patch, path: applied.path, diff: applied.diff });
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "A patch was dropped because it did not apply.");
    }
  }
  return { proposed, warnings };
}

async function gather(input: {
  projectId: string;
  files: { path: string; content: string }[];
  requirements: { text: string }[];
  credentials: Credentials;
  deps: JobFitDeps;
}): Promise<{ evidence: EvidenceSpan[]; note: string; warnings: string[] }> {
  const warnings: string[] = [];
  const evidence = projectEvidence(input.files);
  let note = "Fit used the project files (the same LlamaIndex chunker as Index).";
  const queries = input.requirements.slice(0, 4);
  for (const requirement of queries) {
    try {
      const retrieved = await input.deps.retrieve(input.projectId, requirement.text, input.credentials);
      const parsed = spansFromRetrieval(retrieved);
      if (parsed.note) {
        note = parsed.note;
        logEvent("info", "job_fit.retrieve", { projectId: input.projectId, vectorSpans: 0, note: parsed.note.slice(0, 160) });
        break;
      }
      evidence.push(...parsed.spans);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Vector retrieval did not run.";
      warnings.push(message);
      logEvent("warn", "job_fit.retrieve_failed", { projectId: input.projectId, message });
      break;
    }
  }
  const vectorSpans = evidence.filter((span) => span.backend === "vector").length;
  if (vectorSpans > 0) {
    note = `Vector retrieval added ${vectorSpans} passage${vectorSpans === 1 ? "" : "s"} from the project index.`;
    logEvent("info", "job_fit.retrieve", { projectId: input.projectId, vectorSpans });
  }
  try {
    for (const requirement of queries) {
      const graphText = input.deps.readGraph(input.projectId, requirement.text.slice(0, 80));
      evidence.push(...spansFromGraph(graphText, input.files));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Graph memory could not be read.";
    warnings.push(message);
    logEvent("warn", "job_fit.graph_failed", { projectId: input.projectId, message });
  }
  return { evidence, note, warnings };
}

export async function runJobFit(
  input: {
    projectId: string;
    url?: string;
    text?: string;
    coverLetter?: boolean;
    credentials: Credentials;
    trial?: boolean;
  },
  deps: JobFitDeps = defaultDeps,
): Promise<JobFitResult> {
  const posting = await loadJobPosting({
    url: input.url,
    text: input.text,
    credentials: input.credentials,
  });
  if (!posting.ok) {
    logEvent("warn", "job_fit.blocked", { projectId: input.projectId, code: posting.code });
    return posting;
  }
  logEvent("info", "job_fit.ingest", {
    projectId: input.projectId,
    source: posting.source,
    chars: posting.text.length,
  });

  let description: JobDescription;
  try {
    description = await deps.extract(posting.text, input.credentials);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the job description.";
    logEvent("warn", "job_fit.extract_failed", { projectId: input.projectId, message });
    return {
      ok: false,
      code: "extract_failed",
      message: `${message} Nothing in the project was changed.`,
    };
  }
  description = { ...description, source: posting.source, warnings: [...posting.warnings, ...description.warnings] };
  logEvent("info", "job_fit.extract", {
    projectId: input.projectId,
    requirements: description.requirements.length,
  });

  const files = listTextFiles(input.projectId).filter((file) => /\.(tex|ltx|md|bib)$/i.test(file.path));
  const gathered = await gather({
    projectId: input.projectId,
    files,
    requirements: description.requirements,
    credentials: input.credentials,
    deps,
  });
  const fits = groundRequirements(description.requirements, gathered.evidence);
  const built = buildJobFitPatches({
    files,
    fits,
    role: description.role,
    coverLetter: input.coverLetter !== false,
    existingPaths: new Set(files.map((file) => file.path)),
  });
  const preview = previewAll((filePath) => tryReadText(input.projectId, filePath), built.patches);
  const warnings = [...description.warnings, ...gathered.warnings, ...built.warnings, ...preview.warnings];

  let trial: TrialCompile | null = null;
  if (input.trial !== false && preview.proposed.length > 0) {
    try {
      const overlays = new Map<string, string>();
      const applied = applyPatchSequence(
        (filePath) => tryReadText(input.projectId, filePath),
        preview.proposed,
      );
      for (const file of applied) overlays.set(file.path, file.next);
      trial = await deps.compileTrial(input.projectId, overlays);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Trial compile did not run.";
      warnings.push(message);
      trial = { success: false, summary: message };
      logEvent("warn", "job_fit.trial_failed", { projectId: input.projectId, message });
    }
  }

  const covered = fits.filter((fit) => fit.status === "covered");
  const gaps = fits.filter((fit) => fit.status === "gap");
  logEvent("info", "job_fit.propose", {
    projectId: input.projectId,
    covered: covered.length,
    gaps: gaps.length,
    patches: preview.proposed.length,
  });

  return {
    ok: true,
    role: description.role,
    organization: description.organization,
    source: posting.source,
    warnings,
    covered,
    gaps,
    patches: preview.proposed,
    trial,
    retrievalNote: gathered.note,
  };
}
