import { CircleDot, FlaskConical, ListChecks, ShieldAlert, TriangleAlert, Wrench } from "lucide-react";
import {
  ConfidenceBadge,
  KindTag,
  NeutralBadge,
  SeverityBadge,
  WeightBadge,
  type EvidenceKind,
} from "@/components/common/badges";
import { CodeBlock } from "@/components/common/CodeBlock";
import { CopyButton } from "@/components/common/CopyButton";
import type { Diagnosis } from "@/lib/schema/diagnosis";
import { EvidenceList } from "./EvidenceList";
import { ExportBar } from "./ExportBar";

function Section({
  title,
  kind,
  icon,
  note,
  children,
}: {
  title: string;
  kind?: EvidenceKind;
  icon?: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-card/40 p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
        {kind && <KindTag kind={kind} />}
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
      </header>
      {children}
    </section>
  );
}

/** Renders a validated Diagnosis. All model text is rendered as plain text (React-escaped). */
export function DiagnosisView({ diagnosis: d }: { diagnosis: Diagnosis }) {
  const p = d.provenance;
  const crashcartWarnings = d.warnings.filter((w) => w.source === "crashcart");
  const modelWarnings = d.warnings.filter((w) => w.source === "model");

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <section className="rounded-xl border border-white/10 bg-card/60 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={d.severity} />
          <ConfidenceBadge level={d.confidence.level} />
          <NeutralBadge>{d.category.replace(/_/g, " ")}</NeutralBadge>
          {d.ecosystem !== "unknown" && <NeutralBadge>{d.ecosystem}</NeutralBadge>}
        </div>
        <h2 className="text-base leading-snug font-semibold sm:text-lg">{d.summary}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            Analyzed by <span className="font-medium text-foreground">{p.modelLabel}</span> via {p.providerLabel}
          </span>
          <WeightBadge openWeight={p.openWeight} license={p.license} />
          <span>
            · {(p.durationMs / 1000).toFixed(1)} s · {p.attempts} model call{p.attempts === 1 ? "" : "s"}
            {d.input.redactions.length > 0 && ` · ${d.input.redactions.reduce((n, r) => n + r.count, 0)} secrets redacted`}
          </span>
        </div>
        <div className="mt-4">
          <ExportBar diagnosis={d} />
        </div>
      </section>

      {crashcartWarnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
          {crashcartWarnings.map((w, i) => (
            <p key={i} className="flex gap-2 text-xs text-amber-100">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" aria-hidden />
              {w.message}
            </p>
          ))}
        </div>
      )}

      <Section title="Likely root cause" kind="inferred">
        <p className="text-sm font-medium">{d.rootCause.statement}</p>
        {d.rootCause.explanation && <p className="mt-2 text-sm text-muted-foreground">{d.rootCause.explanation}</p>}
        {d.rootCause.evidenceIds.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Supported by <span className="font-mono text-sky-300">{d.rootCause.evidenceIds.join(", ")}</span>
          </p>
        )}
      </Section>

      <Section title="Evidence" kind="observed">
        <EvidenceList evidence={d.evidence} analyzedText={d.input.analyzedText} />
      </Section>

      <Section
        title="Suggested fix"
        kind="inferred"
        icon={<Wrench className="size-4 text-violet-300" aria-hidden />}
        note="Not yet verified — run the checks below."
      >
        <p className="text-sm">{d.fix.summary}</p>
        <ol className="mt-3 flex flex-col gap-3">
          {d.fix.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-400/15 font-mono text-xs text-violet-200">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{step.title}</p>
                {step.detail && <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>}
                {step.snippet && (
                  <div className="mt-2">
                    <CodeBlock content={step.snippet.content} language={step.snippet.language} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {d.verification.length > 0 && (
        <Section title="Verify the fix" icon={<ListChecks className="size-4 text-emerald-300" aria-hidden />}>
          <ul className="flex flex-col gap-3">
            {d.verification.map((v, i) => (
              <li key={i} className="text-sm">
                <p>{v.step}</p>
                {v.command && (
                  <div className="mt-1.5">
                    <CodeBlock content={v.command} language="command" />
                  </div>
                )}
                {v.expected && <p className="mt-1 text-xs text-muted-foreground">Expected: {v.expected}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Uncertainty" kind="uncertain">
        <p className="text-sm">
          <ConfidenceBadge level={d.confidence.level} /> <span className="text-muted-foreground">{d.confidence.rationale}</span>
        </p>
        {d.confidence.adjustedReason && (
          <p className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/5 px-2 py-1.5 text-xs text-amber-200">
            The model said <strong>{d.confidence.modelReportedLevel}</strong>. {d.confidence.adjustedReason}
          </p>
        )}
        {d.alternatives.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FlaskConical className="size-3.5" aria-hidden /> Other possible explanations
            </p>
            <ul className="flex flex-col gap-2">
              {d.alternatives.map((a, i) => (
                <li key={i} className="rounded-lg border border-white/10 p-2.5 text-sm">
                  <p className="font-medium">{a.hypothesis}</p>
                  {a.whyLessLikely && <p className="mt-0.5 text-xs text-muted-foreground">Less likely: {a.whyLessLikely}</p>}
                  {a.howToCheck && <p className="mt-0.5 text-xs text-muted-foreground">How to check: {a.howToCheck}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.unknowns.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Not visible in this log</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {d.unknowns.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {modelWarnings.length > 0 && (
        <Section title="Warnings" icon={<TriangleAlert className="size-4 text-amber-300" aria-hidden />}>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {modelWarnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="GitHub issue draft" icon={<CircleDot className="size-4 text-muted-foreground" aria-hidden />}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm font-medium break-words">{d.githubIssue.title}</p>
          <CopyButton text={`${d.githubIssue.title}\n\n${d.githubIssue.body}`} label="Copy issue" />
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Show issue body (Markdown)</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-black/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {d.githubIssue.body}
          </pre>
        </details>
      </Section>
    </div>
  );
}
