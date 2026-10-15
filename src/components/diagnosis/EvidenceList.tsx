import { CircleCheck, TriangleAlert } from "lucide-react";
import type { EvidenceView } from "@/lib/schema/diagnosis";

const CONTEXT_LINES = 1;

/** Verified quotes are shown in place, with their real line numbers and a line of context either side. */
export function EvidenceList({ evidence, analyzedText }: { evidence: EvidenceView[]; analyzedText: string }) {
  const lines = analyzedText.split("\n");
  const verified = evidence.filter((e) => e.verified);
  const unverified = evidence.filter((e) => !e.verified);

  return (
    <div className="flex flex-col gap-3">
      {verified.length === 0 && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          None of the model&apos;s quotes could be found in your log. Treat this diagnosis as a guess.
        </p>
      )}

      {verified.map((e) => {
        const start = Math.max(1, (e.lineStart ?? 1) - CONTEXT_LINES);
        const end = Math.min(lines.length, (e.lineEnd ?? 1) + CONTEXT_LINES);
        return (
          <figure key={e.id} className="overflow-hidden rounded-lg border border-white/10">
            <figcaption className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs">
              <span className="font-mono font-semibold text-sky-300">{e.id}</span>
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <CircleCheck className="size-3.5" aria-hidden />
                Found at {e.lineStart === e.lineEnd ? `line ${e.lineStart}` : `lines ${e.lineStart}–${e.lineEnd}`}
              </span>
              {e.significance && <span className="text-muted-foreground">— {e.significance}</span>}
            </figcaption>
            <pre className="overflow-x-auto bg-black/30 py-1.5 text-[11px] leading-relaxed">
              {lines.slice(start - 1, end).map((text, i) => {
                const n = start + i;
                const hit = n >= (e.lineStart ?? 0) && n <= (e.lineEnd ?? 0);
                return (
                  <div key={n} className={hit ? "bg-sky-400/10 text-sky-100" : "text-muted-foreground/60"}>
                    <span className="inline-block w-12 select-none pr-3 text-right font-mono text-muted-foreground/50">{n}</span>
                    <code className="font-mono whitespace-pre">{text || " "}</code>
                  </div>
                );
              })}
            </pre>
          </figure>
        );
      })}

      {unverified.length > 0 && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
            <TriangleAlert className="size-3.5" aria-hidden />
            Couldn&apos;t be confirmed in your log — don&apos;t rely on these
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {unverified.map((e) => (
              <li key={e.id} className="text-xs">
                <span className="font-mono text-amber-300">{e.id}</span>{" "}
                <code className="font-mono break-all text-amber-100/80">{e.quote}</code>{" "}
                <span className="text-amber-200/70">
                  ({e.unverifiedReason === "too_short" ? "too short to check" : "not found — may be paraphrased or invented"})
                </span>
                {e.significance && <span className="block text-muted-foreground">{e.significance}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
