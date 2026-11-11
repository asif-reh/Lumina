import { connection } from "next/server";
import {
  deleteProject,
  fileTree,
  pdfPath,
  readCompileLog,
  readDiagnostics,
  readMeta,
  touchProject,
} from "@/lib/projects";
import { safeRelative } from "@/lib/paths";
import { fail, jsonError, jsonOk } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  await connection();
  try {
    const { id } = await context.params;
    const project = readMeta(id);
    return jsonOk({
      project: { ...project, hasPdf: pdfPath(id) !== null },
      tree: fileTree(id),
      diagnostics: readDiagnostics(id),
      log: readCompileLog(id).slice(-200_000),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { name?: string; mainFile?: string };
    const patch: { name?: string; mainFile?: string } = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.mainFile === "string") patch.mainFile = safeRelative(body.mainFile);
    if (patch.name !== undefined && !patch.name) {
      return jsonError(400, "invalid_name", "Project name cannot be empty.");
    }
    const project = touchProject(id, patch);
    return jsonOk({ project: { ...project, hasPdf: pdfPath(id) !== null } });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    deleteProject(id);
    return jsonOk({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
