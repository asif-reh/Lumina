import { entryArxivId, entryDoi, type BibEntry } from "@/lib/bib";
import {
  judgeDoiHit,
  judgeSearchHit,
  normalizeDoi,
  type PublicRecord,
} from "@/lib/citation-judge";
import type { CitationItem, CitationReport, CitationStatus } from "@/lib/types";

const USER_AGENT =
  "Lumina/0.1 (self-hosted scientific writing workspace; mailto:lumina@localhost)";
const MAX_ENTRIES = 40;

type LookupResult = {
  status: Extract<CitationStatus, "verified" | "mismatch" | "unverified" | "lookup_failed">;
  detail: string;
  source?: PublicRecord["source"];
  matchedTitle?: string;
  matchedYear?: string;
  url?: string;
};

function emptyCounts(): Record<CitationStatus, number> {
  return {
    verified: 0,
    mismatch: 0,
    unverified: 0,
    missing: 0,
    lookup_failed: 0,
  };
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: "",
      error: error instanceof Error ? error.message : "request failed",
    };
  }
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; json?: unknown; error?: string }> {
  const result = await fetchText(url);
  if (!result.ok) return { ok: false, status: result.status, error: result.error };
  try {
    return { ok: true, status: result.status, json: JSON.parse(result.body) };
  } catch {
    return { ok: false, status: result.status, error: "Response was not JSON." };
  }
}

function crossrefRecord(message: Record<string, unknown>, source: PublicRecord["source"]): PublicRecord | null {
  const titles = message.title;
  const title = Array.isArray(titles) ? String(titles[0] ?? "") : "";
  if (!title) return null;
  const authors = Array.isArray(message.author)
    ? message.author.flatMap((author) => {
        if (!author || typeof author !== "object") return [];
        const row = author as Record<string, unknown>;
        const family = typeof row.family === "string" ? row.family : "";
        const given = typeof row.given === "string" ? row.given : "";
        const name = [given, family].filter(Boolean).join(" ").trim();
        return name ? [name] : [];
      })
    : [];
  const issued = message.issued as { "date-parts"?: number[][] } | undefined;
  const year = issued?.["date-parts"]?.[0]?.[0];
  const doi = typeof message.DOI === "string" ? message.DOI : undefined;
  const url = typeof message.URL === "string" ? message.URL : doi ? `https://doi.org/${doi}` : undefined;
  return {
    title,
    authors,
    year: year ? String(year) : undefined,
    doi,
    url,
    source,
  };
}

function openAlexRecord(work: Record<string, unknown>): PublicRecord | null {
  const title = typeof work.display_name === "string" ? work.display_name : "";
  if (!title) return null;
  const authorships = Array.isArray(work.authorships) ? work.authorships : [];
  const authors = authorships.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const author = (row as { author?: { display_name?: string } }).author;
    return author?.display_name ? [author.display_name] : [];
  });
  const year = typeof work.publication_year === "number" ? String(work.publication_year) : undefined;
  const doi = typeof work.doi === "string" ? work.doi : undefined;
  const url = typeof work.id === "string" ? work.id : doi;
  return { title, authors, year, doi, url, source: "openalex" };
}

function parseArxiv(xml: string): PublicRecord | null {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entry) return null;
  const block = entry[1];
  const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim();
  if (!title || title === "Error") return null;
  const authors = [...block.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((match) =>
    match[1].replace(/\s+/g, " ").trim(),
  );
  const published = block.match(/<published>(\d{4})/)?.[1];
  const id = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim();
  return {
    title,
    authors,
    year: published,
    url: id,
    source: "arxiv",
  };
}

function fromHit(
  status: "verified" | "mismatch",
  record: PublicRecord,
  detail: string,
): LookupResult {
  return {
    status,
    detail,
    source: record.source,
    matchedTitle: record.title,
    matchedYear: record.year,
    url: record.url,
  };
}

async function lookupCrossrefDoi(doi: string): Promise<{ record?: PublicRecord; notFound?: boolean; failed?: string }> {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const result = await fetchJson(url);
  if (result.status === 404) return { notFound: true };
  if (!result.ok || !result.json || typeof result.json !== "object") {
    return { failed: result.error || `Crossref returned HTTP ${result.status || "error"}.` };
  }
  const message = (result.json as { message?: Record<string, unknown> }).message;
  if (!message) return { failed: "Crossref returned no work." };
  const record = crossrefRecord(message, "crossref");
  return record ? { record } : { failed: "Crossref work had no title." };
}

async function searchCrossref(title: string): Promise<PublicRecord[]> {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=5`;
  const result = await fetchJson(url);
  if (!result.ok || !result.json || typeof result.json !== "object") return [];
  const items = (result.json as { message?: { items?: Record<string, unknown>[] } }).message?.items ?? [];
  return items.flatMap((item) => {
    const record = crossrefRecord(item, "crossref");
    return record ? [record] : [];
  });
}

async function searchOpenAlex(title: string): Promise<PublicRecord[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=5&mailto=lumina@localhost`;
  const result = await fetchJson(url);
  if (!result.ok || !result.json || typeof result.json !== "object") return [];
  const items = (result.json as { results?: Record<string, unknown>[] }).results ?? [];
  return items.flatMap((item) => {
    const record = openAlexRecord(item);
    return record ? [record] : [];
  });
}

async function lookupArxivId(id: string): Promise<PublicRecord | null> {
  const bare = id.replace(/v\d+$/i, "");
  const result = await fetchText(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(bare)}&max_results=1`,
  );
  if (!result.ok) return null;
  return parseArxiv(result.body);
}

async function searchArxivTitle(title: string): Promise<PublicRecord[]> {
  const query = `ti:"${title.replaceAll('"', " ")}"`;
  const result = await fetchText(
    `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=3`,
  );
  if (!result.ok) return [];
  const records: PublicRecord[] = [];
  const blocks = result.body.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
  for (const block of blocks) {
    const record = parseArxiv(`<entry>${block[1]}</entry>`);
    if (record && record.title !== "Error") records.push(record);
  }
  return records;
}

function semanticRecord(paper: Record<string, unknown>): PublicRecord | null {
  const title = typeof paper.title === "string" ? paper.title : "";
  if (!title) return null;
  const authors = Array.isArray(paper.authors)
    ? paper.authors.flatMap((author) => {
        if (!author || typeof author !== "object") return [];
        const name = (author as { name?: string }).name;
        return name ? [name] : [];
      })
    : [];
  const year = typeof paper.year === "number" ? String(paper.year) : undefined;
  const external = paper.externalIds as { DOI?: string } | undefined;
  const url = typeof paper.url === "string" ? paper.url : external?.DOI ? `https://doi.org/${external.DOI}` : undefined;
  return { title, authors, year, doi: external?.DOI, url, source: "semanticscholar" };
}

async function searchSemanticScholar(title: string, apiKey?: string): Promise<PublicRecord[]> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (apiKey) headers["x-api-key"] = apiKey;
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=5&fields=title,year,authors,url,externalIds`;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: Record<string, unknown>[] };
    return (body.data ?? []).flatMap((paper) => {
      const record = semanticRecord(paper);
      return record ? [record] : [];
    });
  } catch {
    return [];
  }
}

function bestSearch(
  entry: BibEntry,
  records: PublicRecord[],
): LookupResult | null {
  let weak: PublicRecord | null = null;
  for (const record of records) {
    const judgment = judgeSearchHit(
      { title: entry.fields.title, author: entry.fields.author, year: entry.fields.year },
      record,
    );
    if (judgment === "verified") {
      return fromHit("verified", record, `Title, year, and author agree with a ${record.source} record.`);
    }
    weak ??= record;
  }
  if (!weak) return null;
  return {
    status: "unverified",
    detail: `Closest ${weak.source} hit is not confident enough to verify: “${weak.title}”.`,
    source: weak.source,
    matchedTitle: weak.title,
    matchedYear: weak.year,
    url: weak.url,
  };
}

export async function lookupBibliographyEntry(
  entry: BibEntry,
  options?: { semanticScholarKey?: string },
): Promise<LookupResult> {
  const doi = entryDoi(entry);
  let doiFailed = false;
  let networkError: string | undefined;

  if (doi) {
    const normalized = normalizeDoi(doi);
    const hit = await lookupCrossrefDoi(normalized);
    if (hit.record) {
      const judgment = judgeDoiHit(entry.fields.title, hit.record);
      if (judgment === "verified") {
        return fromHit("verified", hit.record, `DOI ${normalized} resolves and the title agrees.`);
      }
      return fromHit(
        "mismatch",
        hit.record,
        `DOI ${normalized} resolves to “${hit.record.title}”, which does not agree with this entry's title.`,
      );
    }
    if (hit.notFound) doiFailed = true;
    if (hit.failed) networkError = hit.failed;
  }

  const arxiv = entryArxivId(entry);
  if (arxiv) {
    const record = await lookupArxivId(arxiv);
    if (record) {
      const judgment = judgeSearchHit(
        { title: entry.fields.title, author: entry.fields.author, year: entry.fields.year },
        record,
      );
      if (judgment === "verified") {
        return fromHit("verified", record, `arXiv:${arxiv} matches this entry.`);
      }
      return fromHit(
        "mismatch",
        record,
        `arXiv:${arxiv} is “${record.title}”, which does not agree with this entry.`,
      );
    }
  }

  const title = entry.fields.title?.trim();
  if (!title) {
    if (networkError && !doiFailed) {
      return { status: "lookup_failed", detail: networkError };
    }
    return {
      status: "unverified",
      detail: doiFailed
        ? `DOI ${normalizeDoi(doi!)} did not resolve, and the entry has no title to search.`
        : "This entry has no title or DOI to check.",
    };
  }

  const crossref = await searchCrossref(title);
  const fromCrossref = bestSearch(entry, crossref);
  if (fromCrossref?.status === "verified") {
    if (doiFailed) {
      fromCrossref.detail = `DOI ${normalizeDoi(doi!)} did not resolve. ${fromCrossref.detail}`;
    }
    return fromCrossref;
  }

  const openAlex = await searchOpenAlex(title);
  const fromOpenAlex = bestSearch(entry, openAlex);
  if (fromOpenAlex?.status === "verified") {
    if (doiFailed) {
      fromOpenAlex.detail = `DOI ${normalizeDoi(doi!)} did not resolve. ${fromOpenAlex.detail}`;
    }
    return fromOpenAlex;
  }

  const scholar = await searchSemanticScholar(title, options?.semanticScholarKey);
  const fromScholar = bestSearch(entry, scholar);
  if (fromScholar?.status === "verified") {
    if (doiFailed) {
      fromScholar.detail = `DOI ${normalizeDoi(doi!)} did not resolve. ${fromScholar.detail}`;
    }
    return fromScholar;
  }

  if (!arxiv) {
    const arxivHits = await searchArxivTitle(title);
    const fromArxiv = bestSearch(entry, arxivHits);
    if (fromArxiv?.status === "verified") return fromArxiv;
    if (fromArxiv && !fromCrossref && !fromOpenAlex) return fromArxiv;
  }

  if (networkError && crossref.length === 0 && openAlex.length === 0 && scholar.length === 0) {
    return { status: "lookup_failed", detail: networkError };
  }

  const partial = fromCrossref ?? fromOpenAlex ?? fromScholar;
  if (partial) return partial;

  return {
    status: "unverified",
    detail: doiFailed
      ? `DOI ${normalizeDoi(doi!)} did not resolve, and no title search was confident.`
      : "No confident match in Crossref, OpenAlex, Semantic Scholar, or arXiv.",
  };
}

export async function buildCitationReport(input: {
  entries: BibEntry[];
  citedKeys: string[];
  missingBibFiles?: string[];
  lookup?: (entry: BibEntry) => Promise<LookupResult>;
  semanticScholarKey?: string;
}): Promise<CitationReport> {
  const lookup =
    input.lookup ?? ((entry: BibEntry) => lookupBibliographyEntry(entry, { semanticScholarKey: input.semanticScholarKey }));
  const warnings = [...(input.missingBibFiles ?? []).map((name) => `Bibliography file ${name}.bib was referenced but not found.`)];
  const cited = new Set(input.citedKeys);
  const known = new Set(input.entries.map((entry) => entry.key));
  const items: CitationItem[] = [];
  const limited = input.entries.slice(0, MAX_ENTRIES);
  const truncated = input.entries.length > MAX_ENTRIES;
  if (truncated) {
    warnings.push(`Only the first ${MAX_ENTRIES} bibliography entries were checked.`);
  }

  for (const entry of limited) {
    const result = await lookup(entry);
    items.push({
      key: entry.key,
      title: entry.fields.title,
      year: entry.fields.year,
      doi: entryDoi(entry),
      status: result.status,
      detail: result.detail,
      source: result.source,
      matchedTitle: result.matchedTitle,
      matchedYear: result.matchedYear,
      url: result.url,
      inBibliography: true,
      cited: cited.has(entry.key),
    });
  }

  for (const key of cited) {
    if (known.has(key)) continue;
    items.push({
      key,
      status: "missing",
      detail: "Cited in the source, but no bibliography entry has this key.",
      inBibliography: false,
      cited: true,
    });
  }

  const counts = emptyCounts();
  for (const item of items) counts[item.status] += 1;

  return {
    checkedAt: new Date().toISOString(),
    items,
    counts,
    warnings,
    truncated,
  };
}
