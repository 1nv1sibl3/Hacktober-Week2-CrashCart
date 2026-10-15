"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ScanSearch } from "lucide-react";
import { DiagnosisView } from "@/components/diagnosis/DiagnosisView";
import { Button } from "@/components/ui/button";
import { checkLog, countLines, DEFAULT_MAX_INPUT_CHARS, keepLastChars, normalizeLog } from "@/lib/input";
import { redact } from "@/lib/redact";
import type { ApiErrorBody, Diagnosis, ProvidersResponse } from "@/lib/schema/diagnosis";
import { LogInput } from "./LogInput";
import { ModelPicker, type Selection } from "./ModelPicker";
import { EmptyState, ErrorState, LoadingState } from "./StatusPanels";

type RunState =
  | { status: "idle" }
  | { status: "loading"; startedAt: number; modelLabel: string }
  | { status: "success"; diagnosis: Diagnosis }
  | { status: "error"; error: ApiErrorBody["error"]; modelLabel: string };

type ProvidersState = { status: "loading" } | { status: "ready"; data: ProvidersResponse } | { status: "error" };

function clientError(code: ApiErrorBody["error"]["code"], message: string): ApiErrorBody["error"] {
  return { code, message, retryable: true, requestId: "client" };
}

export function Workspace() {
  const [log, setLog] = useState("");
  const [providers, setProviders] = useState<ProvidersState>({ status: "loading" });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ProvidersResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        setProviders({ status: "ready", data });
        setSelection(data.defaultSelection);
      })
      .catch(() => !cancelled && setProviders({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const maxChars = providers.status === "ready" ? providers.data.limits.maxInputChars : DEFAULT_MAX_INPUT_CHARS;
  const deferredLog = useDeferredValue(log);
  const normalized = useMemo(() => normalizeLog(deferredLog), [deferredLog]);
  const redaction = useMemo(() => redact(normalized.text), [normalized.text]);
  const check = useMemo(() => checkLog(redaction.text, maxChars), [redaction.text, maxChars]);

  const providerList = providers.status === "ready" ? providers.data.providers : [];
  const selectedModel = providerList.find((p) => p.id === selection?.providerId)?.models.find((m) => m.id === selection?.modelId);
  const modelLabel = selectedModel?.label ?? "the model";
  const busy = run.status === "loading";

  const analyze = useCallback(async () => {
    if (busy || !selection) return;
    // Recompute from the live value (not the deferred one) so exactly what was previewed is sent.
    const payload = redact(normalizeLog(log).text).text;
    if (!checkLog(payload, maxChars).ok) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRun({ status: "loading", startedAt: Date.now(), modelLabel });
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log: payload, providerId: selection.providerId, modelId: selection.modelId }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as { diagnosis?: Diagnosis } & Partial<ApiErrorBody>;
      if (res.ok && data?.diagnosis) {
        setRun({ status: "success", diagnosis: data.diagnosis });
      } else {
        setRun({
          status: "error",
          modelLabel,
          error: data?.error ?? clientError("INTERNAL", `Unexpected response from the server (HTTP ${res.status}).`),
        });
      }
    } catch {
      if (controller.signal.aborted) {
        setRun({ status: "idle" });
      } else {
        setRun({
          status: "error",
          modelLabel,
          error: clientError("UNAVAILABLE", "Couldn't reach the CrashCart server. Check your connection and retry."),
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [busy, selection, log, maxChars, modelLabel]);

  const cancel = () => abortRef.current?.abort();

  const canAnalyze = !busy && check.ok && !!selection && log === deferredLog;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section aria-label="Log input" className="flex flex-col gap-4">
        <LogInput
          value={log}
          onChange={(v) => {
            setLog(v);
            if (run.status === "error") setRun({ status: "idle" });
          }}
          onSubmit={analyze}
          onTrim={() => setLog(keepLastChars(normalized.text, maxChars - 1000))}
          redaction={redaction}
          check={check}
          ansiStripped={normalized.ansiStripped}
          maxChars={maxChars}
          lineCount={countLines(normalized.text)}
          disabled={busy}
        />

        <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-card/40 p-4">
          {providers.status === "loading" && <p className="text-sm text-muted-foreground">Loading configured models…</p>}
          {providers.status === "error" && (
            <p className="text-sm text-rose-300">Couldn&apos;t load the model list. Refresh the page to try again.</p>
          )}
          {providers.status === "ready" && providerList.length === 0 && (
            <p className="text-sm text-amber-200">
              No model provider is configured on this server. Set <code className="font-mono">GEMINI_API_KEY</code> in{" "}
              <code className="font-mono">.env.local</code> (see the README) and restart.
            </p>
          )}
          {providerList.length > 0 && (
            <ModelPicker providers={providerList} selection={selection} onChange={setSelection} disabled={busy} />
          )}
          <Button type="button" size="lg" onClick={analyze} disabled={!canAnalyze} className="w-full">
            <ScanSearch aria-hidden />
            {busy ? "Analyzing…" : `Analyze with ${modelLabel}`}
          </Button>
        </div>
      </section>

      <section aria-label="Diagnosis" ref={resultsRef} className="min-w-0 scroll-mt-4">
        {run.status === "idle" && <EmptyState />}
        {run.status === "loading" && <LoadingState modelLabel={run.modelLabel} startedAt={run.startedAt} onCancel={cancel} />}
        {run.status === "error" && <ErrorState error={run.error} modelLabel={run.modelLabel} onRetry={analyze} />}
        {run.status === "success" && <DiagnosisView diagnosis={run.diagnosis} />}
      </section>
    </div>
  );
}
