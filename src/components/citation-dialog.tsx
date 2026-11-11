"use client";

import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CitationReport, CitationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const LABEL: Record<CitationStatus, string> = {
  verified: "Verified",
  mismatch: "Mismatch",
  unverified: "Unverified",
  missing: "Missing",
  lookup_failed: "Could not check",
};

const TONE: Record<CitationStatus, string> = {
  verified: "bg-emerald-100 text-emerald-900",
  mismatch: "bg-amber-100 text-amber-950",
  unverified: "bg-stone-200 text-stone-800",
  missing: "bg-red-100 text-red-900",
  lookup_failed: "bg-sky-100 text-sky-950",
};

export function CitationDialog({
  open,
  onOpenChange,
  report,
  loading,
  error,
  onCheck,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: CitationReport | null;
  loading: boolean;
  error: string | null;
  onCheck: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl" style={{ maxWidth: 860 }}>
        <DialogHeader>
          <DialogTitle>Citation check</DialogTitle>
          <DialogDescription>
            Each bibliography entry is looked up on Crossref, OpenAlex, or arXiv. A row is verified only when a public
            record agrees. Unmatched and failed lookups stay unmarked.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <Button type="button" onClick={onCheck} disabled={loading}>
            {loading ? "Checking public indexes…" : report ? "Check again" : "Run check"}
          </Button>
          {report && (
            <p className="text-xs text-muted-foreground">
              {report.counts.verified} verified · {report.counts.mismatch} mismatch · {report.counts.unverified} unverified ·{" "}
              {report.counts.missing} missing · {report.counts.lookup_failed} unchecked
            </p>
          )}
        </div>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {!report && !loading && !error && (
          <p className="text-sm leading-6 text-muted-foreground">
            The sample bibliography includes real records and one synthetic entry,{" "}
            <code>luminaDemoUnverifiable2099</code>, which should come back unverified.
          </p>
        )}
        {report && (
          <div className="max-h-[52vh] space-y-3 overflow-auto pr-1">
            {report.warnings.map((warning) => (
              <p key={warning} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-950">
                {warning}
              </p>
            ))}
            {report.items.length === 0 && (
              <p className="text-sm text-muted-foreground">No bibliography entries or citation commands were found.</p>
            )}
            {report.items.map((item) => (
              <motion.article
              key={`${item.key}-${item.status}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-lg border border-border bg-paper px-3 py-2"
            >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[item.status])}>
                    {LABEL[item.status]}
                  </span>
                  <code className="text-xs">{item.key}</code>
                  {!item.cited && item.inBibliography && (
                    <span className="text-[11px] text-muted-foreground">not cited in the source</span>
                  )}
                  {item.url && (
                    <a className="text-[11px] text-primary underline-offset-2 hover:underline" href={item.url} target="_blank" rel="noreferrer">
                      {item.source ?? "record"}
                    </a>
                  )}
                </div>
                {item.title && <p className="mt-1 text-sm">{item.title}</p>}
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                {item.matchedTitle && item.status !== "verified" && (
                  <p className="mt-1 text-xs text-muted-foreground">Closest public title: {item.matchedTitle}</p>
                )}
              </motion.article>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
