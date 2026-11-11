export type Credentials = {
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

const EMPTY: Credentials = {
  openaiKey: "",
  openrouterKey: "",
  provider: "openai",
  model: "gpt-4.1",
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

function header(request: Request, name: string): string {
  return request.headers.get(name)?.trim() ?? "";
}

export function credentialsFromRequest(request: Request): Credentials {
  const providerHeader = header(request, "x-provider");
  const provider = providerHeader === "openrouter" ? "openrouter" : "openai";
  return {
    openaiKey: header(request, "x-openai-key") || process.env.OPENAI_API_KEY?.trim() || "",
    openrouterKey: header(request, "x-openrouter-key") || process.env.OPENROUTER_API_KEY?.trim() || "",
    provider,
    model: header(request, "x-openai-model") || process.env.OPENAI_MODEL?.trim() || "gpt-4.1",
    firecrawlKey: header(request, "x-firecrawl-key") || process.env.FIRECRAWL_API_KEY?.trim() || "",
    langfusePublicKey: header(request, "x-langfuse-public-key") || process.env.LANGFUSE_PUBLIC_KEY?.trim() || "",
    langfuseSecretKey: header(request, "x-langfuse-secret-key") || process.env.LANGFUSE_SECRET_KEY?.trim() || "",
    langfuseHost: header(request, "x-langfuse-host") || process.env.LANGFUSE_HOST?.trim() || "",
    llamaCloudKey: header(request, "x-llama-cloud-key") || process.env.LLAMA_CLOUD_API_KEY?.trim() || "",
    pineconeKey: header(request, "x-pinecone-key") || process.env.PINECONE_API_KEY?.trim() || "",
    pineconeHost: header(request, "x-pinecone-host") || process.env.PINECONE_HOST?.trim() || "",
    zoteroKey: header(request, "x-zotero-key") || process.env.ZOTERO_API_KEY?.trim() || "",
    zoteroUserId: header(request, "x-zotero-user") || process.env.ZOTERO_USER_ID?.trim() || "",
    semanticScholarKey:
      header(request, "x-semantic-scholar-key") || process.env.SEMANTIC_SCHOLAR_API_KEY?.trim() || "",
  };
}

export function chatKey(credentials: Credentials): string | null {
  if (credentials.provider === "openrouter") return credentials.openrouterKey || null;
  return credentials.openaiKey || null;
}

export function missingChatKeyMessage(): string {
  return "Add an OpenAI API key in Settings, or switch the provider to OpenRouter and add that key. Lumina keeps keys in this browser and sends them only with requests that need them.";
}

export function redactSecrets(text: string, credentials: Credentials = EMPTY): string {
  let output = text;
  for (const secret of Object.values(credentials)) {
    if (secret && secret.length > 6) output = output.split(secret).join("[redacted]");
  }
  return output;
}
