import { isStepCount, streamText } from "ai";
import type { Credentials } from "@/lib/intelligence/credentials";
import { redactSecrets } from "@/lib/intelligence/credentials";
import { languageModel } from "@/lib/intelligence/model";
import { estimateCost, observe } from "@/lib/intelligence/observe";
import { assistantInstructions, createAssistantTools, type AssistantSession } from "@/lib/assistant-tools";
import { readCompileLog } from "@/lib/projects";
import type { AssistantMessage, AssistantSelection } from "@/lib/types";

function context(projectId: string, selection: AssistantSelection | null): string {
  const log = readCompileLog(projectId).trim().split("\n").slice(-40).join("\n");
  const parts = [
    "The open project is indexed separately. Call retrieve_project or read_file rather than assuming unseen sources.",
    log ? `Latest compile log tail:\n${log}` : "No compile log yet.",
  ];
  if (selection?.text) {
    parts.push(`User selection ${selection.path}:${selection.startLine}-${selection.endLine}\n${selection.text.slice(0, 4000)}`);
  }
  return parts.join("\n\n");
}

export function streamAssistant(input: {
  projectId: string;
  messages: AssistantMessage[];
  selection: AssistantSelection | null;
  credentials: Credentials;
}): ReadableStream<Uint8Array> {
  const session: AssistantSession = {
    projectId: input.projectId,
    credentials: input.credentials,
    overlays: new Map(),
    patches: [],
    sources: [],
    trial: null,
    compiled: false,
  };
  const spans = new Map<string, { end: (body: { output?: unknown }) => void }>();
  const observation = observe(input.credentials);
  const trace = observation.trace({
    name: "lumina.assistant",
    input: input.messages.slice(-4),
    metadata: { projectId: input.projectId, model: input.credentials.model },
  });
  const generation = trace.generation({
    name: "streamText",
    model: input.credentials.model,
    input: input.messages.slice(-6),
  });
  const encoder = new TextEncoder();
  const result = streamText({
    model: languageModel(input.credentials),
    system: `${assistantInstructions()}\n\n${context(input.projectId, input.selection)}`,
    messages: input.messages
      .filter((message) => message.content.trim())
      .slice(-12)
      .map((message) => ({ role: message.role, content: message.content })),
    tools: createAssistantTools(session),
    stopWhen: isStepCount(8),
    temperature: 0.2,
  });

  return new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let seenPatches = 0;
      let seenSources = 0;
      try {
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") send({ type: "text", text: part.text });
          if (part.type === "tool-call") {
            spans.set(part.toolCallId, trace.span({ name: part.toolName, input: part.input }));
            send({ type: "tool", name: part.toolName, state: "start" });
          }
          if (part.type === "tool-result") {
            const output = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
            spans.get(part.toolCallId)?.end({ output: output.slice(0, 2000) });
            while (seenPatches < session.patches.length) {
              send({ type: "patch", patch: session.patches[seenPatches] });
              seenPatches += 1;
            }
            while (seenSources < session.sources.length) {
              send({ type: "source", source: session.sources[seenSources] });
              seenSources += 1;
            }
            send({ type: "tool", name: part.toolName, state: "done", summary: output.slice(0, 500) });
            if (part.toolName === "compile_project") send({ type: "compiled" });
          }
          if (part.type === "error") {
            const message = part.error instanceof Error ? part.error.message : "The model stream failed.";
            send({ type: "error", message: redactSecrets(message, input.credentials) });
          }
        }
        const usage = await result.usage;
        const cost = estimateCost(input.credentials.model, usage.inputTokens, usage.outputTokens);
        generation.end({
          output: await result.text,
          usage: { promptTokens: usage.inputTokens, completionTokens: usage.outputTokens },
        });
        trace.update({ output: session.patches.map((patch) => patch.path) });
        send({
          type: "done",
          model: input.credentials.model,
          trial: session.trial,
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            estimatedUsd: cost,
          },
          traced: observation.enabled,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The assistant failed.";
        send({ type: "error", message: redactSecrets(message, input.credentials) });
      } finally {
        await observation.flush();
        controller.close();
      }
    },
  });
}
