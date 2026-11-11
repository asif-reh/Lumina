import { createOpenAI } from "@ai-sdk/openai";
import type { Credentials } from "@/lib/intelligence/credentials";
import { chatKey } from "@/lib/intelligence/credentials";

export function languageModel(credentials: Credentials) {
  const key = chatKey(credentials);
  if (!key) {
    throw new Error("Add an OpenAI or OpenRouter key in Settings.");
  }
  if (credentials.provider === "openrouter") {
    return createOpenAI({
      apiKey: key,
      baseURL: "https://openrouter.ai/api/v1",
      name: "openrouter",
    })(credentials.model);
  }
  return createOpenAI({ apiKey: key })(credentials.model);
}
