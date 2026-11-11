"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { readSettings, requestHeaders } from "@/lib/client-settings";
import type { FilePatch } from "@/lib/types";
import type { JobFitReport } from "@/lib/job-fit/types";

export function JobFitDialog({
  open,
  onOpenChange,
  projectId,
  beforeRun,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  beforeRun?: () => Promise<void>;
  onApplied: (files: { path: string; content: string }[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [coverLetter, setCoverLetter] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<JobFitReport | null>(null);
  const [accepted, setAccepted] = useState(false);
  const settings = readSettings();
  const chatReady = settings.provider === "openrouter" ? Boolean(settings.openrouterKey.trim()) : Boolean(settings.openaiKey.trim());
  const firecrawlReady = Boolean(settings.firecrawlKey.trim());

  async function run() {
    setLoading(true);
    setError(null);
    setAccepted(false);
    try {
      await beforeRun?.();
      const next = await api<JobFitReport>(`/api/projects/${projectId}/job-fit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...requestHeaders() },
        body: JSON.stringify({ url, text, coverLetter }),
      });
      setReport(next);
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : "Job Fit failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function accept() {
    if (!report?.patches.length) return;
    const patches: FilePatch[] = report.patches.map((patch) => ({
      path: patch.path,
      description: patch.description,
      newFile: patch.newFile,
      content: patch.content,
      hunks: patch.hunks,
    }));
    try {
      const result = await api<{ files: { path: string; content: string }[] }>(`/api/projects/${projectId}/patches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patches }),
      });
      setAccepted(true);
      onApplied(result.files);
      toast.success(result.files.length === 1 ? `Updated ${result.files[0]?.path}` : `Updated ${result.files.length} files`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not apply those edits.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl" style={{ maxWidth: 860 }}>
        <DialogHeader>
          <DialogTitle>Job Fit</DialogTitle>
          <DialogDescription>
            Paste a posting or give its URL. Lumina compares it with this project and proposes TeX you can accept. It
            does not invent jobs, skills, publications, or metrics.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[62vh] space-y-3 overflow-auto pr-1">
          {!chatReady && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Add an OpenAI or OpenRouter key in Settings to read a posting. A server environment value is used only
              when this browser did not send one. The rest of the desk still works.
            </p>
          )}
          {!firecrawlReady && (
            <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-800">
              No Firecrawl key, so a URL will not be scraped. Paste the job text and Job Fit can still read it.
            </p>
          )}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Posting URL</span>
            <Input
              value={url}
              placeholder="https://example.com/jobs/research-engineer"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Job description</span>
            <Textarea
              value={text}
              className="min-h-32"
              placeholder="Paste the posting. This is used when Firecrawl is missing, and as a fallback if a scrape returns nothing."
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={coverLetter} onChange={(event) => setCoverLetter(event.target.checked)} />
            Propose a cover note as a new TeX file
          </label>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {report && (
            <div className="space-y-3">
              <div>
                <p className="font-display text-2xl text-ink">{report.role}</p>
                {report.organization && <p className="text-sm text-muted-foreground">{report.organization}</p>}
              </div>
              {report.warnings.map((warning) => (
                <p key={warning} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  {warning}
                </p>
              ))}
              <p className="text-xs leading-5 text-muted-foreground">{report.retrievalNote}</p>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Covered</h3>
                {report.covered.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing in this project supports the posting yet.</p>
                )}
                {report.covered.map((fit) => (
                  <motion.article
                    key={fit.requirement.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-border bg-paper px-3 py-2"
                  >
                    <p className="text-sm font-medium">{fit.requirement.text}</p>
                    <p className="text-xs text-muted-foreground">{fit.detail}</p>
                    {fit.evidence.map((span) => (
                      <p key={`${span.source}-${span.text.slice(0, 24)}`} className="mt-1 text-xs leading-5 text-stone-700">
                        <span className="font-mono text-[11px] text-stone-500">
                          {span.source} · {span.backend}
                        </span>
                        <br />
                        {span.text.slice(0, 320)}
                      </p>
                    ))}
                  </motion.article>
                ))}
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Gaps</h3>
                {report.gaps.length === 0 && <p className="text-sm text-muted-foreground">No gaps were flagged.</p>}
                {report.gaps.map((fit) => (
                  <article key={fit.requirement.id} className="rounded-lg bg-stone-100 px-3 py-2">
                    <p className="text-sm font-medium">{fit.requirement.text}</p>
                    <p className="text-xs text-stone-700">{fit.detail}</p>
                  </article>
                ))}
              </section>
              {report.trial && (
                <p
                  className={`rounded-md px-3 py-2 text-xs ${report.trial.success ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950"}`}
                >
                  {report.trial.summary}
                </p>
              )}
              {report.patches.map((patch) => (
                <article key={patch.path} className="space-y-1">
                  <p className="text-sm font-medium">
                    {patch.path}
                    <span className="ml-2 font-normal text-muted-foreground">{patch.description}</span>
                  </p>
                  <pre className="max-h-40 overflow-auto rounded-md bg-[#1C1915] p-2 font-mono text-[11px] leading-4 text-[#F6F1E8]">
                    {patch.diff}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void run()} disabled={loading}>
            {loading ? "Comparing…" : report ? "Run again" : "Compare"}
          </Button>
          <Button type="button" onClick={() => void accept()} disabled={!report?.patches.length || accepted}>
            {accepted ? "Accepted" : "Accept edits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
