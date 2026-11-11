import { connection } from "next/server";
import { createProject, listProjects } from "@/lib/projects";
import { fail, jsonOk } from "@/lib/http";

export async function GET() {
  await connection();
  try {
    return jsonOk({ projects: listProjects() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; seed?: string };
    const seed = body.seed === "cv" ? "cv" : "blank";
    const name = body.name?.trim() || (seed === "cv" ? "Sample CV" : "");
    const project = createProject(name, { seed });
    return jsonOk({ project }, 201);
  } catch (error) {
    return fail(error);
  }
}
