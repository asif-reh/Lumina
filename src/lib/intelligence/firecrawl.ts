import type { SourceProposal } from "@/lib/types";

const BASE = "https://api.firecrawl.dev/v1";

export type FirecrawlPage = {
  url: string;
  title?: string;
  markdown?: string;
  description?: string;
};

function missingKey(): string {
  return "Add a Firecrawl API key in Settings to search or scrape the web. The rest of Lumina keeps working.";
}

async function firecrawl(key: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; data?: unknown };
  if (!response.ok) {
    throw new Error(payload.error || `Firecrawl returned HTTP ${response.status}.`);
  }
  return payload;
}

export function pagesFromSearch(payload: unknown): FirecrawlPage[] {
  const data = (payload as { data?: unknown }).data;
  const rows = Array.isArray(data) ? data : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : "";
    if (!url) return [];
    return [
      {
        url,
        title: typeof record.title === "string" ? record.title : undefined,
        description: typeof record.description === "string" ? record.description : undefined,
        markdown: typeof record.markdown === "string" ? record.markdown : undefined,
      },
    ];
  });
}

export async function firecrawlSearch(key: string, query: string): Promise<FirecrawlPage[] | string> {
  if (!key) return missingKey();
  const payload = await firecrawl(key, "/search", { query, limit: 5 });
  return pagesFromSearch(payload);
}

export async function firecrawlScrape(key: string, url: string): Promise<FirecrawlPage | string> {
  if (!key) return missingKey();
  const payload = (await firecrawl(key, "/scrape", {
    url,
    formats: ["markdown"],
  })) as { data?: { markdown?: string; metadata?: { title?: string; description?: string; sourceURL?: string } } };
  const data = payload.data ?? {};
  return {
    url: data.metadata?.sourceURL || url,
    title: data.metadata?.title,
    description: data.metadata?.description,
    markdown: data.markdown,
  };
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    authors: { type: "string" },
    year: { type: "string" },
    abstract: { type: "string" },
    doi: { type: "string" },
  },
};

export function proposalFromExtract(url: string, extracted: Record<string, unknown>, markdown?: string): SourceProposal {
  const title = typeof extracted.title === "string" ? extracted.title : "";
  const authors = typeof extracted.authors === "string" ? extracted.authors : undefined;
  const year = typeof extracted.year === "string" ? extracted.year : undefined;
  const doi = typeof extracted.doi === "string" ? extracted.doi : undefined;
  const abstract = typeof extracted.abstract === "string" ? extracted.abstract : undefined;
  const key = `web${Date.now().toString(36)}`;
  const bibtex = title
    ? `@misc{${key},\n  title = {${title.replaceAll("{", "").replaceAll("}", "")}},\n  author = {${authors ?? ""}},\n  year = {${year ?? ""}},\n  doi = {${doi ?? ""}},\n  url = {${url}}\n}\n`
    : undefined;
  return {
    id: key,
    title: title || url,
    authors,
    year,
    url,
    doi,
    abstract,
    bibtex,
    markdown,
    origin: "firecrawl",
  };
}

export async function firecrawlExtract(key: string, url: string): Promise<SourceProposal | string> {
  if (!key) return missingKey();
  const payload = (await firecrawl(key, "/scrape", {
    url,
    formats: ["markdown", "json"],
    jsonOptions: {
      prompt: "Extract the scholarly title, authors, year, abstract, and DOI if this page is a paper. Leave fields empty when they are not on the page. Do not invent them.",
      schema: EXTRACT_SCHEMA,
    },
  })) as {
    data?: { markdown?: string; json?: Record<string, unknown>; metadata?: { sourceURL?: string } };
  };
  const data = payload.data ?? {};
  return proposalFromExtract(data.metadata?.sourceURL || url, data.json ?? {}, data.markdown);
}
