import type { Diagnosis } from "@/lib/schema/diagnosis";
import { fence, inlineCode } from "./fence";

export type DiagnosisWithoutIssue = Omit<Diagnosis, "githubIssue">;

/** One-line description of who produced the diagnosis, used in exports. */
export function provenanceLine(d: Pick<Diagnosis, "provenance">): string {
  const p = d.provenance;
  const weights = p.openWeight ? `open-weight${p.license ? `, ${p.license}` : ""}` : "proprietary";
  return `${p.modelLabel} (${weights}) via ${p.providerLabel}`;
}

/** Deterministic GitHub issue body built only from validated diagnosis fields. */
export function buildIssueBody(d: DiagnosisWithoutIssue): string {
  const out: string[] = [];

  out.push("## Summary", d.summary, "");

  out.push(
    "## Environment",
    `- Ecosystem: ${d.ecosystem}`,
    `- Category: ${d.category.replace(/_/g, " ")}`,
    `- Severity: ${d.severity}`,
    "",
  );

  const verified = d.evidence.filter((e) => e.verified);
  out.push("## Error output (excerpts)");
  if (verified.length === 0) {
    out.push("_No excerpt could be matched verbatim to the original log; attach the full log._");
  } else {
    for (const e of verified) {
      const where = e.lineStart === e.lineEnd ? `Line ${e.lineStart}` : `Lines ${e.lineStart}–${e.lineEnd}`;
      out.push(`${where}:`, fence(e.quote, "text"));
    }
  }
  out.push("");

  out.push("## Suspected cause", d.rootCause.statement);
  if (d.rootCause.explanation) out.push("", d.rootCause.explanation);
  out.push("", `_Confidence: ${d.confidence.level} — ${d.confidence.rationale}_`, "");

  out.push("## Proposed fix (not yet verified)");
  d.fix.steps.forEach((step, i) => {
    out.push(`${i + 1}. **${step.title}**${step.detail ? ` — ${step.detail}` : ""}`);
    if (step.snippet) out.push("", fence(step.snippet.content, step.snippet.language), "");
  });
  out.push("");

  if (d.verification.length > 0) {
    out.push("## How to verify");
    for (const v of d.verification) {
      const cmd = v.command ? ` ${inlineCode(v.command)}` : "";
      const expected = v.expected ? ` → expected: ${v.expected}` : "";
      out.push(`- [ ] ${v.step}${cmd}${expected}`);
    }
    out.push("");
  }

  if (d.unknowns.length > 0) {
    out.push("## Open questions", ...d.unknowns.map((u) => `- ${u}`), "");
  }

  out.push(
    "---",
    `_Drafted by CrashCart using ${provenanceLine(d)}. AI-generated and not yet verified — review before posting. Secrets were redacted before analysis._`,
  );

  return out.join("\n");
}
