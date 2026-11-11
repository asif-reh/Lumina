import { planZipImport } from "@/lib/zip-import";
import { importProject } from "@/lib/projects";
import { fail, jsonError, jsonOk } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(400, "missing_file", "Choose a ZIP file to import.");
    }
    if (file.size > 30 * 1024 * 1024) {
      return jsonError(400, "too_large", "ZIP files must be 30 MB or smaller.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const plan = planZipImport(bytes);
    const rawName = form.get("name");
    const fallback = file.name.replace(/\.zip$/i, "") || "Imported project";
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : fallback;
    const project = importProject(name, plan.files, plan.mainFile);
    return jsonOk({ project, warnings: plan.warnings, mainFile: plan.mainFile }, 201);
  } catch (error) {
    return fail(error);
  }
}
