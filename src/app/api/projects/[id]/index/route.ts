import { credentialsFromRequest, redactSecrets } from "@/lib/intelligence/credentials";
import { ingestProject } from "@/lib/intelligence/ingest";
import { fail, jsonOk } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const credentials = credentialsFromRequest(request);
    const result = await ingestProject(id, credentials);
    return jsonOk(result);
  } catch (error) {
    const credentials = credentialsFromRequest(request);
    if (error instanceof Error) {
      return fail(new Error(redactSecrets(error.message, credentials)));
    }
    return fail(error);
  }
}
