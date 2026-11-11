import { generateText } from "ai";
import { chatKey, missingChatKeyMessage, type Credentials } from "@/lib/intelligence/credentials";
import { languageModel } from "@/lib/intelligence/model";
import type { JobDescription, JobRequirement, JobRequirementKind } from "@/lib/job-fit/types";

const KINDS: { field: string; kind: JobRequirementKind }[] = [
  { field: "mustHave", kind: "must" },
  { field: "niceToHave", kind: "nice" },
  { field: "keywords", kind: "keyword" },
  { field: "constraints", kind: "constraint" },
];

function stringField(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("The model did not return job-description JSON.");
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

/**
 * Keep only strings the model actually returned. Unknown fields are ignored,
 * empties are dropped, and duplicates do not become extra requirements.
 */
export function normalizeJobDescription(value: unknown, source: JobDescription["source"]): JobDescription {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Job description JSON was not an object.");
  }
  const record = value as Record<string, unknown>;
  const role = stringField(record.role).slice(0, 160) || "Untitled role";
  const organization = stringField(record.organization).slice(0, 160);
  const requirements: JobRequirement[] = [];
  const seen = new Set<string>();
  for (const { field, kind } of KINDS) {
    const items = record[field];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const text = stringField(item).slice(0, 240);
      if (!text) continue;
      const key = `${kind}:${text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      requirements.push({ id: `${kind}-${requirements.length + 1}`, kind, text });
      if (requirements.length >= 40) break;
    }
  }
  return {
    role,
    organization: organization || undefined,
    requirements,
    source,
    warnings: [],
  };
}

const INSTRUCTIONS = [
  "Extract the posting into JSON with this shape and no other text:",
  '{"role":"","organization":"","mustHave":[],"niceToHave":[],"keywords":[],"constraints":[]}',
  "Copy short phrases from the posting. Do not add skills, employers, degrees, years, or metrics that the posting does not state.",
  "Leave an array empty rather than guessing. Put visa, location, and eligibility lines in constraints.",
].join(" ");

export async function extractJobDescription(text: string, credentials: Credentials): Promise<JobDescription> {
  if (!chatKey(credentials)) {
    throw new Error(missingChatKeyMessage());
  }
  const result = await generateText({
    model: languageModel(credentials),
    temperature: 0,
    system: "You extract job requirements. You never invent requirements that are not written in the posting.",
    prompt: `${INSTRUCTIONS}\n\nPosting:\n${text.slice(0, 20_000)}`,
  });
  return normalizeJobDescription(parseModelJson(result.text), "text");
}
