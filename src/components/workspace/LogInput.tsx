"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock, Scissors, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EXAMPLE_LOGS } from "@/lib/examples";
import type { InputCheck } from "@/lib/input";
import { describeFindings, type RedactionResult } from "@/lib/redact";

export function LogInput({
  value,
  onChange,
  onSubmit,
  onTrim,
  redaction,
  check,
  ansiStripped,
  maxChars,
  lineCount,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onTrim: () => void;
  redaction: RedactionResult;
  check: InputCheck;
  ansiStripped: boolean;
  maxChars: number;
  lineCount: number;
  disabled: boolean;
}) {
  const [showSent, setShowSent] = useState(false);
  const empty = value.trim().length === 0;
  const chars = redaction.text.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Try a sample:</span>
        {EXAMPLE_LOGS.map((ex) => (
          <Button
            key={ex.id}
            type="button"
            size="xs"
            variant="secondary"
            title={ex.description}
            disabled={disabled}
            onClick={() => onChange(ex.log)}
          >
            {ex.label}
          </Button>
        ))}
      </div>

      <label htmlFor="log-input" className="sr-only">
        Log to analyze
      </label>
      <Textarea
        id="log-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={"Paste terminal output, a stack trace, a build log, or `docker compose` output…\n\nTip: include a few lines before the error, and the command you ran."}
        className="field-sizing-fixed h-72 resize-y font-mono text-xs leading-relaxed sm:h-96 lg:h-[28rem]"
        aria-describedby="log-input-status"
      />

      <div id="log-input-status" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className={chars > maxChars ? "text-rose-300" : undefined}>
          {chars.toLocaleString("en-US")} / {maxChars.toLocaleString("en-US")} chars · {lineCount.toLocaleString("en-US")} lines
          {ansiStripped && " · color codes removed"}
        </span>
        {!empty && (
          <Button type="button" size="xs" variant="ghost" onClick={() => onChange("")} disabled={disabled}>
            <X aria-hidden /> Clear
          </Button>
        )}
      </div>

      {!check.ok && !empty && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          <span>{check.message}</span>
          {check.code === "INPUT_TOO_LARGE" && (
            <Button type="button" size="xs" variant="outline" onClick={onTrim}>
              <Scissors aria-hidden /> Keep the last {(maxChars - 1000).toLocaleString("en-US")} characters
            </Button>
          )}
        </div>
      )}

      {!empty && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Lock className="size-3.5 text-emerald-400" aria-hidden />
              {redaction.total > 0 ? (
                <span>
                  <span className="text-emerald-300">{redaction.total} item{redaction.total === 1 ? "" : "s"} redacted</span> in your
                  browser before sending ({describeFindings(redaction.findings)}).
                </span>
              ) : (
                <span>No secrets detected. Redaction runs in your browser before anything is sent.</span>
              )}
            </span>
            <Button type="button" size="xs" variant="ghost" onClick={() => setShowSent((s) => !s)} aria-expanded={showSent}>
              {showSent ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {showSent ? "Hide" : "View"} what will be sent
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            Best-effort: API keys, tokens, passwords, private keys, and emails are masked. Hostnames and IPs are kept because
            debugging often needs them. Review before sending anything sensitive.
          </p>
          {showSent && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-black/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
              {redaction.text.split(/(\[REDACTED:[A-Z_]+\])/).map((part, i) =>
                part.startsWith("[REDACTED:") ? (
                  <mark key={i} className="rounded bg-emerald-400/20 px-0.5 text-emerald-200">
                    {part}
                  </mark>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
