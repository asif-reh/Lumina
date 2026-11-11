import path from "path";
import { readFile } from "fs/promises";
import { connection } from "next/server";
import { rawFile } from "@/lib/projects";
import { fail } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".eps": "application/postscript",
};

export async function GET(request: Request, context: Context) {
  await connection();
  try {
    const { id } = await context.params;
    const relative = new URL(request.url).searchParams.get("path") ?? "";
    const file = rawFile(id, relative);
    const ext = path.extname(file.name).toLowerCase();
    const bytes = await readFile(file.full);
    return new Response(bytes, {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${file.name.replaceAll('"', "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
