import { credentialsFromRequest } from "@/lib/intelligence/credentials";
import { runProjectCitationCheck } from "@/lib/intelligence/citation-run";
import { fail, jsonError, jsonOk } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { projectId?: string };
    if (!body.projectId) return jsonError(400, "invalid_body", "Send a project id.");
    const credentials = credentialsFromRequest(request);
    const report = await runProjectCitationCheck(body.projectId, credentials.semanticScholarKey);
    return jsonOk(report);
  } catch (error) {
    return fail(error);
  }
}
