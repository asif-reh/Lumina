export const API_KEY_STORAGE = "lumina.openai.apiKey";
export const MODEL_STORAGE = "lumina.openai.model";
export const PROJECT_STORAGE = "lumina.lastProjectId";
export const SETTINGS_STORAGE = "lumina.settings";

export const DEFAULT_MODEL = "gpt-4.1";

export const MODEL_CHOICES = [
  {
    id: "gpt-4.1",
    label: "gpt-4.1",
    note: "Default. Tool calling is reliable, and the model is generally available.",
  },
  {
    id: "gpt-4.1-mini",
    label: "gpt-4.1-mini",
    note: "Faster, for smaller prose edits.",
  },
  {
    id: "gpt-5.2",
    label: "gpt-5.2",
    note: "Use this when your key has access to it.",
  },
] as const;

export type LuminaSettings = {
  openaiKey: string;
  openrouterKey: string;
  provider: "openai" | "openrouter";
  model: string;
  firecrawlKey: string;
  langfusePublicKey: string;
  langfuseSecretKey: string;
  langfuseHost: string;
  llamaCloudKey: string;
  pineconeKey: string;
  pineconeHost: string;
  zoteroKey: string;
  zoteroUserId: string;
  semanticScholarKey: string;
};

const EMPTY: LuminaSettings = {
  openaiKey: "",
  openrouterKey: "",
  provider: "openai",
  model: DEFAULT_MODEL,
  firecrawlKey: "",
  langfusePublicKey: "",
  langfuseSecretKey: "",
  langfuseHost: "",
  llamaCloudKey: "",
  pineconeKey: "",
  pineconeHost: "",
  zoteroKey: "",
  zoteroUserId: "",
  semanticScholarKey: "",
};

export function readSettings(): LuminaSettings {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE) ?? "{}") as Partial<LuminaSettings>;
    return {
      ...EMPTY,
      ...parsed,
      openaiKey: parsed.openaiKey || window.localStorage.getItem(API_KEY_STORAGE) || "",
      model: parsed.model || window.localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL,
      provider: parsed.provider === "openrouter" ? "openrouter" : "openai",
    };
  } catch {
    return { ...EMPTY, openaiKey: window.localStorage.getItem(API_KEY_STORAGE) ?? "" };
  }
}

export function writeSettings(settings: LuminaSettings) {
  window.localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(settings));
  if (settings.openaiKey.trim()) window.localStorage.setItem(API_KEY_STORAGE, settings.openaiKey.trim());
  else window.localStorage.removeItem(API_KEY_STORAGE);
  window.localStorage.setItem(MODEL_STORAGE, settings.model.trim() || DEFAULT_MODEL);
}

export function readApiKey(): string {
  return readSettings().openaiKey;
}

export function writeApiKey(value: string) {
  const settings = readSettings();
  settings.openaiKey = value.trim();
  writeSettings(settings);
}

export function readModel(): string {
  return readSettings().model || DEFAULT_MODEL;
}

export function writeModel(value: string) {
  const settings = readSettings();
  settings.model = value.trim() || DEFAULT_MODEL;
  writeSettings(settings);
}

export function readLastProject(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PROJECT_STORAGE) ?? "";
}

export function writeLastProject(id: string) {
  window.localStorage.setItem(PROJECT_STORAGE, id);
}

export function requestHeaders(): Record<string, string> {
  const settings = readSettings();
  const headers: Record<string, string> = {
    "x-provider": settings.provider,
    "x-openai-model": settings.model || DEFAULT_MODEL,
  };
  const pairs: [string, string][] = [
    ["x-openai-key", settings.openaiKey],
    ["x-openrouter-key", settings.openrouterKey],
    ["x-firecrawl-key", settings.firecrawlKey],
    ["x-langfuse-public-key", settings.langfusePublicKey],
    ["x-langfuse-secret-key", settings.langfuseSecretKey],
    ["x-langfuse-host", settings.langfuseHost],
    ["x-llama-cloud-key", settings.llamaCloudKey],
    ["x-pinecone-key", settings.pineconeKey],
    ["x-pinecone-host", settings.pineconeHost],
    ["x-zotero-key", settings.zoteroKey],
    ["x-zotero-user", settings.zoteroUserId],
    ["x-semantic-scholar-key", settings.semanticScholarKey],
  ];
  for (const [name, value] of pairs) {
    if (value.trim()) headers[name] = value.trim();
  }
  return headers;
}

export function hasChatKey(): boolean {
  const settings = readSettings();
  return settings.provider === "openrouter" ? Boolean(settings.openrouterKey.trim()) : Boolean(settings.openaiKey.trim());
}
