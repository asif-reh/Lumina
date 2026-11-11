import { credentialsFromRequest, redactSecrets } from "@/lib/intelligence/credentials";
import { observe } from "@/lib/intelligence/observe";
import { runJobFit } from "@/lib/job-fit/run";
import { logEvent } from "@/lib/log";
import { fail, jsonError, jsonOk } from "@/lib/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const credentials = credentialsFromRequest(request);
  const observation = observe(credentials);
  const { id } = await context.params;
  const trace = observation.trace({
    name: "lumina.job_fit",
    metadata: { projectId: id },
  });
  try {
    const body = (await request.json().catch(() => ({}))) as {
      url?: string;
      text?: string;
      coverLetter?: boolean;
    };
    const result = await runJobFit({
      projectId: id,
      url: typeof body.url === "string" ? body.url : undefined,
      text: typeof body.text === "string" ? body.text : undefined,
      coverLetter: body.coverLetter !== false,
      credentials,
    });
    if (!result.ok) {
      trace.update({ output: { ok: false, code: result.code } });
      const status = result.code === "missing_openai" || result.code === "missing_firecrawl" ? 401 : 400;
      return jsonError(status, result.code, result.message);
    }
    trace.update({
      output: { ok: true, covered: result.covered.length, gaps: result.gaps.length, patches: result.patches.length },
    });
    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? redactSecrets(error.message, credentials) : "Request failed.";
    logEvent("error", "job_fit.failed", { projectId: id, message });
    return fail(new Error(message));
  } finally {
    await observation.flush();
  }
}
