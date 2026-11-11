import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/projects/[id]/job-fit/route";
import type { Credentials } from "@/lib/intelligence/credentials";
import { groundRequirements, spansFromRetrieval } from "@/lib/job-fit/ground";
import { loadJobPosting } from "@/lib/job-fit/ingest";
import { buildJobFitPatches, isPermutationHunk } from "@/lib/job-fit/patches";
import { normalizeJobDescription, parseModelJson } from "@/lib/job-fit/parse";
import { runJobFit } from "@/lib/job-fit/run";
import { visibleText } from "@/lib/job-fit/text";
import type { JobDescription } from "@/lib/job-fit/types";
import { healthStatus } from "@/lib/health";
import { createProject, listTextFiles } from "@/lib/projects";

const emptyCredentials: Credentials = {
  openaiKey: "",
  openrouterKey: "",
  provider: "openai",
  model: "gpt-4.1",
  firecrawlKey: "",
  langfusePublicKey: "",
  langfuseSecretKey: "",
  langfuseHost: "",
  llamaCloudKey: "",
  pineconeKey: "",
  pineconeHost: "",
  zoteroKey: "",
  zoteroUserId: "",
  semanticScholarKey: "",
};

const previousData = process.env.LUMINA_DATA_DIR;
const previousDb = process.env.DATABASE_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (previousData === undefined) delete process.env.LUMINA_DATA_DIR;
  else process.env.LUMINA_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDb;
});

describe("job description parsing", () => {
  it("keeps only strings the model returned", () => {
    const raw = [
      "```json",
      JSON.stringify({
        role: "Research engineer",
        organization: "Northwind",
        mustHave: ["pgvector", "", "pgvector"],
        niceToHave: ["Kubernetes"],
        keywords: ["retrieval"],
        constraints: ["Must be authorized to work in the US"],
        inventedSkills: ["led a team of 40"],
      }),
      "```",
    ].join("\n");
    const description = normalizeJobDescription(parseModelJson(raw), "text");
    expect(description.role).toBe("Research engineer");
    expect(description.organization).toBe("Northwind");
    expect(description.requirements.map((item) => item.text)).toEqual([
      "pgvector",
      "Kubernetes",
      "retrieval",
      "Must be authorized to work in the US",
    ]);
    expect(description.requirements.map((item) => item.kind)).toEqual(["must", "nice", "keyword", "constraint"]);
    expect(JSON.stringify(description)).not.toMatch(/team of 40/);
  });
});

describe("evidence grounding", () => {
  it("does not treat a retrieval error as evidence", () => {
    const parsed = spansFromRetrieval(
      "Retrieval needs an OpenAI API key for embeddings. Add one in Settings, then use Index project. You can still read files directly.",
    );
    expect(parsed.spans).toEqual([]);
    const hits = spansFromRetrieval(
      "(1) main.tex [0.82]\nBuilt a retrieval service over pgvector.\n\n(2) sources/retrieval-note.md [0.41]\nThe pgvector index stores one embedding per chunk.",
    );
    expect(hits.spans.map((span) => span.source)).toEqual(["main.tex", "sources/retrieval-note.md"]);
    expect(hits.spans.every((span) => span.backend === "vector")).toBe(true);
    const [fit] = groundRequirements([{ id: "must-1", kind: "must", text: "embeddings" }], parsed.spans);
    expect(fit?.status).toBe("gap");
  });

  it("flags requirements the project does not support and quotes only existing sentences", async () => {
    process.env.LUMINA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-job-fit-"));
    delete process.env.DATABASE_URL;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network should not be called"));
    const project = createProject("Sample CV", { seed: "cv" });
    const files = listTextFiles(project.id);
    const corpus = files.map((file) => file.content).join("\n");
    expect(corpus.toLowerCase()).not.toContain("kubernetes");
    expect(corpus).not.toContain("40%");

    const extracted: JobDescription = normalizeJobDescription(
      {
        role: "Kubernetes Captain",
        mustHave: ["pgvector", "Kubernetes", "Reduced latency by 40%"],
        niceToHave: ["TypeScript"],
        keywords: [],
        constraints: ["Must be authorized to work in the US"],
      },
      "text",
    );
    const result = await runJobFit(
      {
        projectId: project.id,
        text: "Ignored because extract is injected.",
        credentials: { ...emptyCredentials, provider: "openrouter", openrouterKey: "or-test-key" },
        coverLetter: true,
        trial: false,
      },
      {
        extract: async () => extracted,
        retrieve: async () =>
          "Retrieval needs an OpenAI API key for embeddings. Add one in Settings, then use Index project.",
        readGraph: () => 'No claim in the graph contains "Kubernetes".',
        compileTrial: async () => ({ success: true, summary: "unused" }),
      },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.covered.map((item) => item.requirement.text).sort()).toEqual(["TypeScript", "pgvector"]);
    expect(result.gaps.map((item) => item.requirement.text)).toEqual([
      "Kubernetes",
      "Reduced latency by 40%",
      "Must be authorized to work in the US",
    ]);
    for (const fit of result.covered) {
      expect(fit.evidence.length).toBeGreaterThan(0);
      for (const span of fit.evidence) {
        expect(span.text.toLowerCase()).toContain(fit.requirement.text.toLowerCase());
        const file = files.find((entry) => entry.path === span.source);
        expect(file?.content).toContain(span.text.slice(0, 40));
      }
    }
    const letter = result.patches.find((patch) => patch.newFile);
    expect(letter?.content).toBeTruthy();
    const shown = visibleText(letter?.content ?? "");
    expect(shown.toLowerCase()).not.toContain("kubernetes");
    expect(shown).not.toContain("40%");
    expect(shown.toLowerCase()).not.toContain("authorized");
    expect(shown.toLowerCase()).toContain("pgvector");
    for (const patch of result.patches) {
      if (patch.newFile) {
        const bullets = [...(patch.content ?? "").matchAll(/\\item\s+(.+)/g)].map((match) => match[1] ?? "");
        expect(bullets.length).toBeGreaterThan(0);
        for (const bullet of bullets) {
          const plain = bullet.replaceAll("\\%", "%").replaceAll("\\_", "_");
          expect(corpus.toLowerCase()).toContain(plain.toLowerCase());
        }
      } else {
        for (const hunk of patch.hunks ?? []) expect(isPermutationHunk(hunk)).toBe(true);
      }
    }
  });
});

describe("resume edits stay inside existing bullets", () => {
  it("reorders matching bullets and refuses a fabricated replacement", () => {
    const content = "\\begin{itemize}\n\\item Kept the lab notebook.\n\\item Built a retrieval service over pgvector.\n\\end{itemize}\n";
    const files = [{ path: "main.tex", content }];
    const fits = groundRequirements(
      [{ id: "must-1", kind: "must", text: "pgvector" }],
      [{ source: "main.tex", text: content, backend: "project" }],
    );
    const built = buildJobFitPatches({
      files,
      fits,
      role: "Research engineer",
      coverLetter: false,
      existingPaths: new Set(["main.tex"]),
    });
    const hunk = built.patches[0]?.hunks?.[0];
    expect(hunk).toBeTruthy();
    if (!hunk) return;
    expect(isPermutationHunk(hunk)).toBe(true);
    expect(hunk.replace.indexOf("pgvector")).toBeLessThan(hunk.replace.indexOf("notebook"));
    expect(hunk.replace).not.toMatch(/40/);
    expect(
      isPermutationHunk({
        search: "\\begin{itemize}\n\\item Kept the lab notebook.\n\\end{itemize}",
        replace: "\\begin{itemize}\n\\item Led a team of 40.\\end{itemize}",
      }),
    ).toBe(false);
  });
});

describe("job fit degrades when a key is missing", () => {
  it("does not scrape when Firecrawl is missing and does not call out without a chat key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network should not be called"));
    const noChat = await loadJobPosting({
      url: "https://jobs.example.com/research-engineer",
      credentials: { ...emptyCredentials, firecrawlKey: "fc-test-key" },
    });
    expect(noChat.ok).toBe(false);
    if (!noChat.ok) expect(noChat.message).toMatch(/OpenAI|OpenRouter/);

    const noFirecrawl = await loadJobPosting({
      url: "https://jobs.example.com/research-engineer",
      credentials: { ...emptyCredentials, openaiKey: "sk-test-not-real" },
    });
    expect(noFirecrawl.ok).toBe(false);
    if (!noFirecrawl.ok) expect(noFirecrawl.message).toMatch(/Firecrawl/);

    const pasted = await loadJobPosting({
      url: "https://jobs.example.com/research-engineer",
      text: "Research engineer who has shipped pgvector.",
      credentials: { ...emptyCredentials, openaiKey: "sk-test-not-real" },
    });
    expect(pasted.ok).toBe(true);
    if (pasted.ok) {
      expect(pasted.source).toBe("text");
      expect(pasted.warnings.join(" ")).toMatch(/Firecrawl/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the same messages from the API route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network should not be called"));
    const urlOnly = await POST(
      new Request("http://127.0.0.1/api/projects/demo/job-fit", {
        method: "POST",
        headers: { "content-type": "application/json", "x-openai-key": "sk-test-not-real" },
        body: JSON.stringify({ url: "https://jobs.example.com/research-engineer" }),
      }),
      { params: Promise.resolve({ id: "demo" }) },
    );
    expect(urlOnly.status).toBe(401);
    const urlBody = (await urlOnly.json()) as { message: string };
    expect(urlBody.message).toMatch(/Firecrawl/);

    const noKey = await POST(
      new Request("http://127.0.0.1/api/projects/demo/job-fit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Research engineer. pgvector required." }),
      }),
      { params: Promise.resolve({ id: "demo" }) },
    );
    expect(noKey.status).toBe(401);
    const keyBody = (await noKey.json()) as { message: string };
    expect(keyBody.message).toMatch(/OpenAI|OpenRouter/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("health", () => {
  it("reports process health without secrets", () => {
    delete process.env.DATABASE_URL;
    const status = healthStatus();
    expect(status.ok).toBe(true);
    expect(status.service).toBe("lumina");
    expect(status.databaseConfigured).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/sk-|api[_-]?key/i);
  });
});
