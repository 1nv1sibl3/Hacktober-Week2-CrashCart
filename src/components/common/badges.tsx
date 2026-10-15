import { CircleQuestionMark, Eye, Lightbulb } from "lucide-react";
import type { ConfidenceLevel, Severity } from "@/lib/schema/diagnosis";
import { cn } from "@/lib/utils";

const pill = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

export type EvidenceKind = "observed" | "inferred" | "uncertain";

const KIND = {
  observed: { label: "Observed in your log", Icon: Eye, cls: "border-sky-400/30 bg-sky-400/10 text-sky-300" },
  inferred: { label: "Inferred by the model", Icon: Lightbulb, cls: "border-violet-400/30 bg-violet-400/10 text-violet-300" },
  uncertain: { label: "Uncertain", Icon: CircleQuestionMark, cls: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
} as const;

export function KindTag({ kind }: { kind: EvidenceKind }) {
  const { label, Icon, cls } = KIND[kind];
  return (
    <span className={cn(pill, cls)}>
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

const CONFIDENCE: Record<ConfidenceLevel, string> = {
  high: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  low: "border-rose-400/30 bg-rose-400/10 text-rose-300",
};

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  return <span className={cn(pill, CONFIDENCE[level])}>{level} confidence</span>;
}

const SEVERITY: Record<Severity, string> = {
  blocking: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  degraded: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  minor: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  unknown: "border-white/15 bg-white/5 text-muted-foreground",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={cn(pill, SEVERITY[severity])}>{severity === "unknown" ? "severity unknown" : severity}</span>;
}

export function NeutralBadge({ children }: { children: React.ReactNode }) {
  return <span className={cn(pill, "border-white/15 bg-white/5 text-muted-foreground")}>{children}</span>;
}

export function WeightBadge({ openWeight, license }: { openWeight: boolean; license?: string }) {
  return openWeight ? (
    <span className={cn(pill, "border-emerald-400/30 bg-emerald-400/10 text-emerald-300")}>
      Open-weight{license ? ` · ${license}` : ""}
    </span>
  ) : (
    <span className={cn(pill, "border-white/15 bg-white/5 text-muted-foreground")}>Proprietary</span>
  );
}
