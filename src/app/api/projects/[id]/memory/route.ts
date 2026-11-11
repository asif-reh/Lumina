import { connection } from "next/server";
import { loadMemory, queryMemory } from "@/lib/intelligence/memory";
import { fail, jsonOk } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  await connection();
  try {
    const { id } = await context.params;
    const kind = new URL(request.url).searchParams.get("kind") ?? "summary";
    const text = new URL(request.url).searchParams.get("text") ?? "";
    const memory = loadMemory(id);
    const queryKind = kind === "unverified" || kind === "supports" ? kind : "summary";
    return jsonOk({
      summary: queryMemory(memory, "summary"),
      answer: queryMemory(memory, queryKind, text),
      nodes: memory.nodes.length,
      edges: memory.edges.length,
    });
  } catch (error) {
    return fail(error);
  }
}
