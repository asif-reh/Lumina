"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  MODEL_CHOICES,
  readSettings,
  writeSettings,
  type LuminaSettings,
} from "@/lib/client-settings";

function Field({
  label,
  value,
  onChange,
  placeholder,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  note: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="block text-xs leading-5 text-muted-foreground">{note}</span>
    </label>
  );
}

export function SettingsForm() {
  const [settings, setSettings] = useState<LuminaSettings>(readSettings);
  const [custom, setCustom] = useState(() => !MODEL_CHOICES.some((choice) => choice.id === readSettings().model));

  function patch(partial: Partial<LuminaSettings>) {
    setSettings((current) => ({ ...current, ...partial }));
  }

  function save() {
    writeSettings(settings);
    toast.success("Settings saved in this browser.");
  }

  const sections = [
    {
      title: "Chat model",
      body: (
        <div className="space-y-3">
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={settings.provider === "openai"}
                onChange={() => patch({ provider: "openai" })}
              />
              OpenAI
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={settings.provider === "openrouter"}
                onChange={() => patch({ provider: "openrouter" })}
              />
              OpenRouter
            </label>
          </div>
          <Field
            label="OpenAI API key"
            value={settings.openaiKey}
            placeholder="sk-…"
            onChange={(openaiKey) => patch({ openaiKey })}
            note="Required for the assistant when the provider is OpenAI, and always required for embeddings. Stored only in this browser."
          />
          <Field
            label="OpenRouter API key"
            value={settings.openrouterKey}
            placeholder="sk-or-…"
            onChange={(openrouterKey) => patch({ openrouterKey })}
            note="Optional. Used for chat when the provider is OpenRouter, so the product is not locked to one vendor."
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Model</legend>
            {MODEL_CHOICES.map((choice) => (
              <label key={choice.id} className="flex cursor-pointer gap-3 rounded-lg border border-border bg-paper px-3 py-2">
                <input
                  type="radio"
                  className="mt-1"
                  checked={!custom && settings.model === choice.id}
                  onChange={() => {
                    setCustom(false);
                    patch({ model: choice.id });
                  }}
                />
                <span>
                  <span className="block text-sm font-medium">{choice.label}</span>
                  <span className="block text-xs text-muted-foreground">{choice.note}</span>
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer gap-3 rounded-lg border border-border bg-paper px-3 py-2">
              <input type="radio" className="mt-1" checked={custom} onChange={() => setCustom(true)} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Other model id</span>
                <Input
                  className="mt-1"
                  value={custom ? settings.model : ""}
                  placeholder="openai/gpt-4.1"
                  onFocus={() => setCustom(true)}
                  onChange={(event) => {
                    setCustom(true);
                    patch({ model: event.target.value });
                  }}
                />
              </span>
            </label>
          </fieldset>
        </div>
      ),
    },
    {
      title: "Retrieval and parsing",
      body: (
        <div className="space-y-3">
          <Field
            label="LlamaCloud API key"
            value={settings.llamaCloudKey}
            placeholder="llx-…"
            onChange={(llamaCloudKey) => patch({ llamaCloudKey })}
            note="Optional. Uploaded PDFs use LlamaParse when this is set, and the local unpdf extractor otherwise."
          />
          <Field
            label="Pinecone API key"
            value={settings.pineconeKey}
            onChange={(pineconeKey) => patch({ pineconeKey })}
            note="Optional. Without it, vectors go to Postgres pgvector when DATABASE_URL is set, or to a local file index."
          />
          <Field
            label="Pinecone index host"
            value={settings.pineconeHost}
            placeholder="https://index-xxxx.svc.pinecone.io"
            onChange={(pineconeHost) => patch({ pineconeHost })}
            note="Required only with the Pinecone key. This is the index host, not the control-plane URL."
          />
        </div>
      ),
    },
    {
      title: "Sources",
      body: (
        <div className="space-y-3">
          <Field
            label="Firecrawl API key"
            value={settings.firecrawlKey}
            placeholder="fc-…"
            onChange={(firecrawlKey) => patch({ firecrawlKey })}
            note="Optional. Unlocks web search, scrape, and structured extraction. You accept items before they enter the bibliography."
          />
          <Field
            label="Zotero API key"
            value={settings.zoteroKey}
            onChange={(zoteroKey) => patch({ zoteroKey })}
            note="Optional. Search your library and accept items into the project .bib."
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Zotero user id</span>
            <Input value={settings.zoteroUserId} onChange={(event) => patch({ zoteroUserId: event.target.value })} />
          </label>
          <Field
            label="Semantic Scholar API key"
            value={settings.semanticScholarKey}
            onChange={(semanticScholarKey) => patch({ semanticScholarKey })}
            note="Optional. Citation checks call Semantic Scholar either way. A key raises the rate limit."
          />
        </div>
      ),
    },
    {
      title: "Tracing",
      body: (
        <div className="space-y-3">
          <Field
            label="Langfuse public key"
            value={settings.langfusePublicKey}
            onChange={(langfusePublicKey) => patch({ langfusePublicKey })}
            note="Optional. When both Langfuse keys are set, assistant runs, tools, and token estimates are traced. Otherwise tracing is skipped."
          />
          <Field
            label="Langfuse secret key"
            value={settings.langfuseSecretKey}
            onChange={(langfuseSecretKey) => patch({ langfuseSecretKey })}
            note="Sent only with assistant and index requests. It is not written to the project folder."
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Langfuse host</span>
            <Input
              value={settings.langfuseHost}
              placeholder="https://cloud.langfuse.com"
              onChange={(event) => patch({ langfuseHost: event.target.value })}
            />
          </label>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-2">
        <p className="font-display text-3xl tracking-tight text-ink">Settings</p>
        <p className="text-sm leading-6 text-muted-foreground">
          Every key is optional. Chat needs an OpenAI key or an OpenRouter key. Embeddings always use the OpenAI key.
          Keys stay in this browser and travel only as request headers.
        </p>
      </div>
      {sections.map((section, index) => (
        <motion.section
          key={section.title}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: index * 0.04 }}
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <h2 className="font-display text-xl text-ink">{section.title}</h2>
          {section.body}
        </motion.section>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save}>
          Save in this browser
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const cleared = { ...settings, openaiKey: "", openrouterKey: "", firecrawlKey: "", langfuseSecretKey: "", llamaCloudKey: "", pineconeKey: "", zoteroKey: "", semanticScholarKey: "" };
            setSettings(cleared);
            writeSettings(cleared);
            toast.success("Cleared saved keys from this browser.");
          }}
        >
          Remove keys
        </Button>
        <Link href="/" className={cn(buttonVariants({ variant: "ghost" }))}>
          Back to the desk
        </Link>
      </div>
    </div>
  );
}
