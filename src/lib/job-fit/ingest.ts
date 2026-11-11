import { chatKey, missingChatKeyMessage, type Credentials } from "@/lib/intelligence/credentials";
import { firecrawlScrape } from "@/lib/intelligence/firecrawl";
import type { JobFitBlocker } from "@/lib/job-fit/types";

export type LoadedPosting = {
  ok: true;
  text: string;
  source: "url" | "text";
  warnings: string[];
};

const FIRECRAWL_MISSING =
  "Add a Firecrawl API key in Settings to scrape a job posting URL. The rest of Lumina keeps working. Paste the description if you want Job Fit without Firecrawl.";

function blocker(code: JobFitBlocker["code"], message: string): JobFitBlocker {
  return { ok: false, code, message };
}

export function httpUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function loadJobPosting(input: {
  url?: string;
  text?: string;
  credentials: Credentials;
}): Promise<LoadedPosting | JobFitBlocker> {
  const pasted = input.text?.trim() ?? "";
  const url = httpUrl(input.url);
  const urlAttempt = Boolean(input.url?.trim());
  if (!url && !pasted) {
    return blocker(
      urlAttempt ? "missing_input" : "missing_input",
      urlAttempt
        ? "Provide an http(s) job posting URL, or paste the description."
        : "Paste a job description or provide a posting URL.",
    );
  }
  if (!chatKey(input.credentials)) {
    return blocker(
      "missing_openai",
      `${missingChatKeyMessage()} Job Fit uses that key only to read the posting, then keeps every resume edit inside text this project already contains.`,
    );
  }
  if (url && !input.credentials.firecrawlKey.trim()) {
    if (pasted) {
      return {
        ok: true,
        text: pasted.slice(0, 50_000),
        source: "text",
        warnings: [
          "No Firecrawl key, so the posting URL was not scraped. Job Fit is reading the pasted text instead.",
        ],
      };
    }
    return blocker("missing_firecrawl", FIRECRAWL_MISSING);
  }
  if (!url) {
    return { ok: true, text: pasted.slice(0, 50_000), source: "text", warnings: [] };
  }
  try {
    const page = await firecrawlScrape(input.credentials.firecrawlKey, url);
    if (typeof page === "string") {
      if (pasted) {
        return { ok: true, text: pasted.slice(0, 50_000), source: "text", warnings: [page] };
      }
      return blocker("missing_firecrawl", page);
    }
    const scraped = (page.markdown || page.description || "").trim();
    if (!scraped) {
      if (pasted) {
        return {
          ok: true,
          text: pasted.slice(0, 50_000),
          source: "text",
          warnings: ["Firecrawl returned no text for that URL. Parsed the pasted description instead."],
        };
      }
      return blocker("empty_posting", "Firecrawl returned no text for that URL. Paste the job description instead.");
    }
    return { ok: true, text: scraped.slice(0, 50_000), source: "url", warnings: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Firecrawl failed.";
    if (pasted) {
      return {
        ok: true,
        text: pasted.slice(0, 50_000),
        source: "text",
        warnings: [`Could not scrape the URL (${message}). Parsed the pasted description instead.`],
      };
    }
    return blocker("scrape_failed", message);
  }
}
