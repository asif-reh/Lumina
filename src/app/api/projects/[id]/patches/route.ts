import type { FilePatch } from "@/lib/types";
import { applyPatchSequence } from "@/lib/patches";
import { tryReadText, writeTextFile } from "@/lib/projects";
import { fail, jsonError, jsonOk } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { patches?: FilePatch[] };
    const patches = body.patches ?? [];
    if (!Array.isArray(patches) || patches.length === 0) {
      return jsonError(400, "no_patches", "There are no edits to apply.");
    }
    if (patches.length > 20) {
      return jsonError(400, "too_many", "Apply at most 20 patches at once.");
    }
    const applied = applyPatchSequence((filePath) => tryReadText(id, filePath), patches);
    for (const file of applied) {
      writeTextFile(id, file.path, file.next);
    }
    return jsonOk({
      files: applied.map((file) => ({ path: file.path, content: file.next })),
    });
  } catch (error) {
    return fail(error);
  }
}
