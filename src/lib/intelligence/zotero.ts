import type { SourceProposal } from "@/lib/types";

export async function searchZotero(input: {
  key: string;
  userId: string;
  query: string;
}): Promise<SourceProposal[] | string> {
  if (!input.key || !input.userId) {
    return "Add a Zotero API key and user id in Settings to search your library. Citation checking still works without Zotero.";
  }
  const url = new URL(`https://api.zotero.org/users/${encodeURIComponent(input.userId)}/items`);
  url.searchParams.set("q", input.query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("format", "json");
  url.searchParams.set("include", "data");
  const response = await fetch(url, {
    headers: { "Zotero-API-Key": input.key, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Zotero returned HTTP ${response.status}. Check the user id and key.`);
  }
  const rows = (await response.json()) as {
    key?: string;
    data?: { title?: string; creators?: { firstName?: string; lastName?: string; name?: string }[]; date?: string; DOI?: string; abstractNote?: string; url?: string; itemType?: string };
  }[];
  return rows.flatMap((row) => {
    const data = row.data;
    if (!data?.title || data.itemType === "attachment" || data.itemType === "note") return [];
    const authors = (data.creators ?? [])
      .map((creator) => creator.name || [creator.lastName, creator.firstName].filter(Boolean).join(", "))
      .filter(Boolean)
      .join(" and ");
    const year = (data.date ?? "").slice(0, 4);
    const key = `zotero${row.key ?? Date.now().toString(36)}`;
    const bibtex = `@misc{${key},\n  title = {${data.title}},\n  author = {${authors}},\n  year = {${year}},\n  doi = {${data.DOI ?? ""}},\n  url = {${data.url ?? ""}}\n}\n`;
    return [
      {
        id: key,
        title: data.title,
        authors,
        year,
        doi: data.DOI,
        url: data.url,
        abstract: data.abstractNote,
        bibtex,
        origin: "zotero" as const,
      },
    ];
  });
}

export async function zoteroBibTeX(input: { key: string; userId: string }): Promise<string> {
  const url = new URL(`https://api.zotero.org/users/${encodeURIComponent(input.userId)}/items`);
  url.searchParams.set("format", "bibtex");
  url.searchParams.set("limit", "100");
  const response = await fetch(url, {
    headers: { "Zotero-API-Key": input.key },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Zotero BibTeX export failed (${response.status}).`);
  return response.text();
}
