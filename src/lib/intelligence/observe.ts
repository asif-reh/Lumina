import { Langfuse } from "langfuse";
import type { Credentials } from "@/lib/intelligence/credentials";

export type Observation = {
  trace: (body: { name: string; input?: unknown; metadata?: Record<string, string> }) => {
    generation: (body: { name: string; model?: string; input?: unknown }) => {
      end: (body: { output?: unknown; usage?: { promptTokens?: number; completionTokens?: number } }) => void;
    };
    span: (body: { name: string; input?: unknown }) => { end: (body: { output?: unknown }) => void };
    update: (body: { output?: unknown }) => void;
  };
  flush: () => Promise<void>;
  enabled: boolean;
};

const noop = {
  generation: () => ({ end: () => undefined }),
  span: () => ({ end: () => undefined }),
  update: () => undefined,
};

export function observe(credentials: Credentials): Observation {
  if (!credentials.langfusePublicKey || !credentials.langfuseSecretKey) {
    return {
      enabled: false,
      trace: () => noop,
      flush: async () => undefined,
    };
  }
  const client = new Langfuse({
    publicKey: credentials.langfusePublicKey,
    secretKey: credentials.langfuseSecretKey,
    baseUrl: credentials.langfuseHost || "https://cloud.langfuse.com",
  });
  return {
    enabled: true,
    trace: (body) => client.trace(body),
    flush: () => client.flushAsync(),
  };
}

const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
};

export function estimateCost(model: string, promptTokens = 0, completionTokens = 0): number | null {
  const price = PRICE_PER_MILLION[model];
  if (!price) return null;
  return (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output;
}
