import { readFile } from "fs/promises";
import { connection } from "next/server";
import { pdfPath } from "@/lib/projects";
import { jsonError } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  await connection();
  try {
    const { id } = await context.params;
    const file = pdfPath(id);
    if (!file) {
      return jsonError(404, "no_pdf", "No PDF yet. Compile the project first.");
    }
    const bytes = await readFile(file);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=lumina.pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the PDF.";
    return jsonError(404, "no_pdf", message);
  }
}
