"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { hasChatKey, requestHeaders } from "@/lib/client-settings";
import type { AssistantResponse, AssistantSelection, FilePatch, ProposedPatch, SourceProposal } from "@/lib/types";

type ToolTrace = { name: string; state: "start" | "done"; summary?: string };

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  patches: ProposedPatch[];
  decisions: Record<number, "pending" | "accepted" | "rejected">;
  sources: SourceProposal[];
  sourceState: Record<string, "pending" | "saved">;
  tools: ToolTrace[];
  trial: AssistantResponse["trial"];
  note?: string;
};

export function AssistantPane({
  projectId,
  selection,
  seed,
  onApplied,
  onCompiled,
}: {
  projectId: string;
  selection: (AssistantSelection & { path: string }) | null;
  seed: { id: number; text: string } | null;
  onApplied: (files: { path: string; content: string }[]) => void;
  onCompiled?: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const seenSeed = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => setHasKey(hasChatKey());
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    if (!hasChatKey()) {
      setHasKey(false);
      toast.error("Add an OpenAI or OpenRouter key in Settings before asking the assistant.");
      return;
    }
    const history = [
      ...turns.map((turn) => ({ role: turn.role, content: turn.content })),
      { role: "user" as const, content },
    ];
    const assistantId = crypto.randomUUID();
    setTurns((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content, patches: [], decisions: {}, sources: [], sourceState: {}, tools: [], trial: null },
      { id: assistantId, role: "assistant", content: "", patches: [], decisions: {}, sources: [], sourceState: {}, tools: [], trial: null },
    ]);
    setDraft("");
    setBusy(true);
    const update = (recipe: (turn: Turn) => Turn) => {
      setTurns((current) => current.map((turn) => (turn.id === assistantId ? recipe(turn) : turn)));
    };
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...requestHeaders() },
        body: JSON.stringify({ projectId, messages: history, selection }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || "The assistant failed.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The assistant returned an empty stream.");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as {
            type: string;
            text?: string;
            name?: string;
            state?: "start" | "done";
            summary?: string;
            patch?: ProposedPatch;
            source?: SourceProposal;
            message?: string;
            trial?: AssistantResponse["trial"];
            usage?: { estimatedUsd: number | null };
            traced?: boolean;
          };
          if (event.type === "text" && event.text) {
            update((turn) => ({ ...turn, content: turn.content + event.text }));
          }
          if (event.type === "tool" && event.name && event.state) {
            update((turn) => ({
              ...turn,
              tools: [...turn.tools.filter((tool) => !(tool.name === event.name && tool.state === "start" && event.state === "done")), { name: event.name!, state: event.state!, summary: event.summary }],
            }));
          }
          if (event.type === "patch" && event.patch) {
            update((turn) => ({
              ...turn,
              patches: [...turn.patches, event.patch!],
              decisions: { ...turn.decisions, [turn.patches.length]: "pending" },
            }));
          }
          if (event.type === "compiled") onCompiled?.();
          if (event.type === "source" && event.source) {
            update((turn) => ({
              ...turn,
              sources: [...turn.sources, event.source!],
              sourceState: { ...turn.sourceState, [event.source!.id]: "pending" },
            }));
          }
          if (event.type === "error" && event.message) {
            update((turn) => ({ ...turn, content: turn.content || event.message! }));
          }
          if (event.type === "done") {
            const cost = event.usage?.estimatedUsd;
            const note = [
              event.traced ? "Traced in Langfuse." : "Langfuse is not configured, so this turn was not traced.",
              cost != null ? `Estimated cost $${cost.toFixed(4)}.` : "",
            ]
              .filter(Boolean)
              .join(" ");
            update((turn) => ({ ...turn, trial: event.trial ?? turn.trial, note }));
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The assistant failed.";
      update((turn) => ({ ...turn, content: turn.content || message }));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!seed || seenSeed.current === seed.id) return;
    seenSeed.current = seed.id;
    void send(seed.text);
    // send is recreated each render; the seed id guards duplicate sends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  async function decide(turnId: string, indexes: number[], decision: "accepted" | "rejected") {
    const turn = turns.find((item) => item.id === turnId);
    if (!turn) return;
    const chosen = indexes.map((index) => turn.patches[index]).filter((patch): patch is ProposedPatch => Boolean(patch));
    if (decision === "accepted") {
      try {
        const body: { patches: FilePatch[] } = {
          patches: chosen.map((patch) => ({
            path: patch.path,
            description: patch.description,
            newFile: patch.newFile,
            content: patch.content,
            hunks: patch.hunks,
          })),
        };
        const result = await api<{ files: { path: string; content: string }[] }>(
          `/api/projects/${projectId}/patches`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        onApplied(result.files);
        toast.success(result.files.length === 1 ? `Updated ${result.files[0]?.path}` : `Updated ${result.files.length} files`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not apply that edit.");
        return;
      }
    }
    setTurns((current) =>
      current.map((item) => {
        if (item.id !== turnId) return item;
        const decisions = { ...item.decisions };
        for (const index of indexes) decisions[index] = decision;
        return { ...item, decisions };
      }),
    );
  }

  async function acceptSource(turnId: string, source: SourceProposal, destination: "bib" | "note") {
    try {
      await api(`/api/projects/${projectId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...requestHeaders() },
        body: JSON.stringify({ proposal: source, destination }),
      });
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId ? { ...turn, sourceState: { ...turn.sourceState, [source.id]: "saved" } } : turn,
        ),
      );
      toast.success(destination === "bib" ? "Added to the bibliography and reindexed." : "Saved the note and reindexed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that source.");
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-paper">
      <header className="border-b border-border px-3 py-2">
        <p className="font-display text-lg leading-none text-ink">Assistant</p>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          Reads the project and the latest log. Edits arrive as diffs.
        </p>
      </header>
      {!hasKey && (
        <div className="border-b border-border bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
          No chat key in this browser. Compilation and citation checks still work.{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            Add a key in Settings
          </Link>{" "}
          to ask for rewrites or compile fixes.
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="space-y-2 text-sm leading-6 text-muted-foreground">
            <p>Ask for a rewrite, a table, a TikZ figure, or a fix for the last compile error.</p>
            <p>Nothing is written until you accept a diff. A trial compile, when the model runs one, uses a sandbox copy.</p>
          </div>
        )}
        {turns.map((turn) => (
          <article key={turn.id} className={turn.role === "user" ? "ml-6" : ""}>
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {turn.role === "user" ? "You" : "Lumina"}
            </p>
            <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">{turn.content}</p>
            {turn.tools?.map((tool, index) => (
              <p key={`${tool.name}-${index}`} className="mt-1 font-mono text-[11px] text-muted-foreground">
                {tool.state === "start" ? "Running" : "Finished"} {tool.name}
                {tool.summary ? ` — ${tool.summary.slice(0, 160)}` : ""}
              </p>
            ))}
            {turn.note && <p className="mt-1 text-[11px] text-muted-foreground">{turn.note}</p>}
            {turn.trial && (
              <p
                className={
                  turn.trial.success
                    ? "mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-900"
                    : "mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-950"
                }
              >
                {turn.trial.summary}
              </p>
            )}
            {turn.sources?.map((source) => (
              <div key={source.id} className="mt-2 rounded-lg border border-border bg-desk px-2 py-2">
                <p className="text-sm">{source.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {source.origin} {source.year ? `· ${source.year}` : ""} {source.doi ? `· ${source.doi}` : ""}
                </p>
                {(turn.sourceState?.[source.id] ?? "pending") === "pending" ? (
                  <div className="mt-2 flex gap-1">
                    <Button type="button" size="xs" onClick={() => void acceptSource(turn.id, source, "bib")}>
                      Add to bibliography
                    </Button>
                    <Button type="button" size="xs" variant="outline" onClick={() => void acceptSource(turn.id, source, "note")}>
                      Save note
                    </Button>
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">Saved and queued for indexing.</p>
                )}
              </div>
            ))}
            {turn.patches.map((patch, index) => {
              const state = turn.decisions[index] ?? "pending";
              return (
                <motion.div
                  key={`${patch.path}-${index}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="mt-2 overflow-hidden rounded-lg border border-border"
                >
                  <div className="flex items-start justify-between gap-2 bg-desk px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px]">{patch.path}</p>
                      {patch.description && <p className="text-[11px] text-muted-foreground">{patch.description}</p>}
                    </div>
                    {state === "pending" ? (
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" size="xs" onClick={() => void decide(turn.id, [index], "accepted")}>
                          <Check /> Accept
                        </Button>
                        <Button type="button" size="xs" variant="outline" onClick={() => void decide(turn.id, [index], "rejected")}>
                          <X /> Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{state}</span>
                    )}
                  </div>
                  <pre className="max-h-56 overflow-auto bg-[#1C1915] px-2 py-2 font-mono text-[11px] leading-4 text-[#F6F1E8]">
                    {patch.diff}
                  </pre>
                </motion.div>
              );
            })}
            {turn.patches.some((_, index) => (turn.decisions[index] ?? "pending") === "pending") && turn.patches.length > 1 && (
              <Button
                type="button"
                size="xs"
                className="mt-2"
                onClick={() =>
                  void decide(
                    turn.id,
                    turn.patches.map((_, index) => index).filter((index) => (turn.decisions[index] ?? "pending") === "pending"),
                    "accepted",
                  )
                }
              >
                Accept remaining
              </Button>
            )}
          </article>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Reading the project and, if needed, trial-compiling.
          </p>
        )}
      </div>
      <form
        className="border-t border-border p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        {selection?.text && (
          <p className="mb-1 truncate text-[11px] text-muted-foreground">
            Selection {selection.path}:{selection.startLine}–{selection.endLine}
          </p>
        )}
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Rewrite the selection, or ask for a compile fix…"
          className="min-h-16 bg-background"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}
