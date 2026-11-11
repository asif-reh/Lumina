import { extractText } from "unpdf";

export async function extractPdfLocally(bytes: Uint8Array): Promise<string> {
  const result = await extractText(bytes, { mergePages: true });
  return result.text;
}

async function llamaParse(bytes: Uint8Array, filename: string, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)]), filename);
  const upload = await fetch("https://api.cloud.llamaindex.ai/api/parsing/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!upload.ok) {
    throw new Error(`LlamaParse upload failed (${upload.status}).`);
  }
  const body = (await upload.json()) as { id?: string };
  if (!body.id) throw new Error("LlamaParse did not return a job id.");
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const status = await fetch(`https://api.cloud.llamaindex.ai/api/parsing/job/${body.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const job = (await status.json()) as { status?: string };
    if (job.status === "SUCCESS") break;
    if (job.status === "ERROR" || job.status === "FAILED") {
      throw new Error("LlamaParse failed to read that PDF.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const result = await fetch(`https://api.cloud.llamaindex.ai/api/parsing/job/${body.id}/result/markdown`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!result.ok) throw new Error(`LlamaParse result failed (${result.status}).`);
  const payload = (await result.json()) as { markdown?: string };
  if (!payload.markdown?.trim()) throw new Error("LlamaParse returned empty markdown.");
  return payload.markdown;
}

export async function extractPdf(bytes: Uint8Array, filename: string, llamaCloudKey: string): Promise<{
  text: string;
  parser: "llamaparse" | "unpdf";
  note?: string;
}> {
  if (llamaCloudKey) {
    try {
      const text = await llamaParse(bytes, filename, llamaCloudKey);
      return { text, parser: "llamaparse" };
    } catch (error) {
      const text = await extractPdfLocally(bytes);
      const reason = error instanceof Error ? error.message : "LlamaParse failed.";
      return {
        text,
        parser: "unpdf",
        note: `${reason} Fell back to the local PDF text extractor.`,
      };
    }
  }
  return {
    text: await extractPdfLocally(bytes),
    parser: "unpdf",
    note: "No LlamaCloud key is set, so Lumina used the local PDF text extractor.",
  };
}
