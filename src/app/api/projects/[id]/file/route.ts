import { connection } from "next/server";
import { deletePath, readTextFile, textFile, writeTextFile } from "@/lib/projects";
import { fail, jsonError, jsonOk } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  try {
    const { id } = await context.params;
    const relative = new URL(request.url).searchParams.get("path") ?? "";
    if (!textFile(relative)) {
      return jsonError(415, "binary_file", "This file is not opened in the text editor.");
    }
    const content = readTextFile(id, relative);
    return jsonOk({ path: relative, content, binary: false });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { path?: string; content?: string };
    if (!body.path || typeof body.content !== "string") {
      return jsonError(400, "invalid_body", "Send a path and text content.");
    }
    writeTextFile(id, body.path, body.content);
    return jsonOk({ path: body.path, saved: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const relative = new URL(request.url).searchParams.get("path") ?? "";
    deletePath(id, relative);
    return jsonOk({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
