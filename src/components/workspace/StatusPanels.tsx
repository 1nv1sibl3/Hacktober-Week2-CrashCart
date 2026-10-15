"use client";

import { useEffect, useState } from "react";
import { CircleAlert, Eye, LoaderCircle, Lightbulb, CircleQuestionMark, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApiErrorBody } from "@/lib/schema/diagnosis";

export function EmptyState() {
  return (
    <div className="flex h-full flex-col justify-center gap-5 rounded-xl border border-dashed border-white/10 p-6 sm:p-8">
      <div>
        <h2 className="text-base font-semibold">Your diagnosis will appear here</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a log or pick a sample, then press <kbd className="rounded border border-white/15 px-1 font-mono text-[11px]">Ctrl</kbd>
          {" + "}
          <kbd className="rounded border border-white/15 px-1 font-mono text-[11px]">Enter</kbd>. Every result separates three kinds of claims:
        </p>
      </div>
      <ul className="grid gap-3 text-sm sm:grid-cols-3">
        <li className="rounded-lg border border-sky-400/20 bg-sky-400/5 p-3">
          <Eye className="mb-1 size-4 text-sky-300" aria-hidden />
          <p className="font-medium text-sky-200">Observed</p>
          <p className="text-xs text-muted-foreground">Exact lines from your log. CrashCart checks each quote exists and finds its line number.</p>
        </li>
        <li className="rounded-lg border border-violet-400/20 bg-violet-400/5 p-3">
          <Lightbulb className="mb-1 size-4 text-violet-300" aria-hidden />
          <p className="font-medium text-violet-200">Inferred</p>
          <p className="text-xs text-muted-foreground">The model&apos;s root cause and fix, tied to the evidence that supports them.</p>
        </li>
        <li className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <CircleQuestionMark className="mb-1 size-4 text-amber-300" aria-hidden />
          <p className="font-medium text-amber-200">Uncertain</p>
          <p className="text-xs text-muted-foreground">Confidence, alternative explanations, and what the log doesn&apos;t show.</p>
        </li>
      </ul>
    </div>
  );
}

export function LoadingState({ modelLabel, startedAt, onCancel }: { modelLabel: string; startedAt: number; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div role="status" aria-live="polite" className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-white/10 p-8 text-center">
      <LoaderCircle className="size-8 animate-spin text-orange-400" aria-hidden />
      <div>
        <p className="font-medium">{modelLabel} is analyzing your log…</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {seconds}s elapsed · usually 10–30 s. CrashCart then checks every quoted line against your log.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onCancel}>
        <X aria-hidden /> Cancel
      </Button>
    </div>
  );
}

const ERROR_TITLES: Partial<Record<ApiErrorBody["error"]["code"], string>> = {
  RATE_LIMITED: "Rate limited",
  QUOTA_EXHAUSTED: "Quota used up",
  TIMEOUT: "The model took too long",
  UNAVAILABLE: "Provider unavailable",
  MODEL_OUTPUT_INVALID: "The model's answer was unusable",
  NOT_CONFIGURED: "Model not available",
  AUTH_FAILED: "Provider credentials rejected",
  CONTENT_BLOCKED: "Blocked by the provider",
};

export function ErrorState({ error, modelLabel, onRetry }: { error: ApiErrorBody["error"]; modelLabel: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex h-full flex-col justify-center gap-4 rounded-xl border border-rose-400/30 bg-rose-400/5 p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-5 shrink-0 text-rose-300" aria-hidden />
        <div>
          <h2 className="font-semibold text-rose-100">{ERROR_TITLES[error.code] ?? "Analysis failed"}</h2>
          <p className="mt-1 text-sm text-rose-100/80">{error.message}</p>
          {error.retryAfterSeconds ? (
            <p className="mt-1 text-xs text-rose-100/60">Suggested wait: about {error.retryAfterSeconds} s.</p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Model: {modelLabel}. CrashCart never switches models on its own — retry, or choose another model on the left.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onRetry}>
          <RotateCcw aria-hidden /> Retry with {modelLabel}
        </Button>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {error.code} · ref {error.requestId.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}
