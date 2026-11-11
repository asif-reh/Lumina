import type { AssistantMessage, AssistantSelection } from "@/lib/types";
import { streamAssistant } from "@/lib/assistant-stream";
import { chatKey, credentialsFromRequest, missingChatKeyMessage } from "@/lib/intelligence/credentials";
import { fail, jsonError } from "@/lib/http";

export async function POST(request: Request) {
  const credentials = credentialsFromRequest(request);
  if (!chatKey(credentials)) {
    return jsonError(401, "missing_api_key", missingChatKeyMessage());
  }
  try {
    const body = (await request.json()) as {
      projectId?: string;
      messages?: AssistantMessage[];
      selection?: AssistantSelection | null;
    };
    if (!body.projectId || !Array.isArray(body.messages)) {
      return jsonError(400, "invalid_body", "Send a project and a message.");
    }
    const stream = streamAssistant({
      projectId: body.projectId,
      messages: body.messages,
      selection: body.selection ?? null,
      credentials,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
