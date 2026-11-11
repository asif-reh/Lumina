import type { ProposedPatch, TrialCompile } from "@/lib/types";

export type JobRequirementKind = "must" | "nice" | "keyword" | "constraint";

export type JobRequirement = {
  id: string;
  kind: JobRequirementKind;
  text: string;
};

export type JobDescription = {
  role: string;
  organization?: string;
  requirements: JobRequirement[];
  source: "url" | "text";
  warnings: string[];
};

export type EvidenceSpan = {
  source: string;
  text: string;
  backend: "project" | "vector" | "graph";
};

export type RequirementFit = {
  requirement: JobRequirement;
  status: "covered" | "gap";
  evidence: EvidenceSpan[];
  missing: string[];
  detail: string;
};

export type JobFitBlocker = {
  ok: false;
  code: "missing_input" | "missing_openai" | "missing_firecrawl" | "empty_posting" | "scrape_failed" | "extract_failed";
  message: string;
};

export type JobFitReport = {
  ok: true;
  role: string;
  organization?: string;
  source: "url" | "text";
  warnings: string[];
  covered: RequirementFit[];
  gaps: RequirementFit[];
  patches: ProposedPatch[];
  trial: TrialCompile | null;
  retrievalNote: string;
};

export type JobFitResult = JobFitReport | JobFitBlocker;
