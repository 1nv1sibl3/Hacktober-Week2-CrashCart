import type { Diagnosis } from "@/lib/schema/diagnosis";
import { fence, inlineCode } from "./fence";
import { provenanceLine } from "./github-issue";

/** Full Markdown debugging report for download. Built only from the validated diagnosis. */
export function buildMarkdownReport(d: Diagnosis): string {
  const out: string[] = [];
  const p = d.provenance;

  out.push("# CrashCart debugging report", "");
  out.push(
    "| | |",
    "|---|---|",
    `| Generated | ${d.createdAt} |`,
    `| Model | ${provenanceLine(d)} |`,
    `| Analysis time | ${(p.durationMs / 1000).toFixed(1)} s (${p.attempts} model call${p.attempts === 1 ? "" : "s"}) |`,
    `| Category | ${d.category.replace(/_/g, " ")} · ${d.ecosystem} · severity ${d.severity} |`,
    `| Confidence | ${d.confidence.level}${d.confidence.adjustedReason ? ` (model said ${d.confidence.modelReportedLevel})` : ""} |`,
    `| Redacted before analysis | ${d.input.redactions.length ? d.input.redactions.map((r) => `${r.count} × ${r.type}`).join(", ") : "nothing detected"} |`,
    `| Schema | v${d.schemaVersion} |`,
    "",
  );

  out.push("> AI-generated diagnosis. The suggested fix has **not** been verified — run the verification steps.", "");

  out.push("## Summary", d.summary, "");

  out.push("## Likely root cause (inferred)", `**${d.rootCause.statement}**`);
  if (d.rootCause.explanation) out.push("", d.rootCause.explanation);
  if (d.rootCause.evidenceIds.length) out.push("", `Based on evidence: ${d.rootCause.evidenceIds.join(", ")}`);
  out.push("");

  out.push("## Evidence (observed in the log)");
  const verified = d.evidence.filter((e) => e.verified);
  const unverified = d.evidence.filter((e) => !e.verified);
  if (verified.length === 0) out.push("_None of the quoted lines could be matched to the log._");
  for (const e of verified) {
    const where = e.lineStart === e.lineEnd ? `line ${e.lineStart}` : `lines ${e.lineStart}–${e.lineEnd}`;
    out.push(`**${e.id}** — ${where}${e.significance ? `: ${e.significance}` : ""}`, fence(e.quote, "text"), "");
  }
  if (unverified.length > 0) {
    out.push("### ⚠ Quotes not found in the log (treat as unverified)");
    for (const e of unverified) {
      const why = e.unverifiedReason === "too_short" ? " _(too short to check)_" : "";
      out.push(`**${e.id}**${why}${e.significance ? ` — ${e.significance}` : ""}`, fence(e.quote, "text"), "");
    }
  }
  out.push("");

  out.push("## Suggested fix (not yet verified)", d.fix.summary, "");
  d.fix.steps.forEach((step, i) => {
    out.push(`${i + 1}. **${step.title}**${step.detail ? ` — ${step.detail}` : ""}`);
    if (step.snippet) out.push("", fence(step.snippet.content, step.snippet.language), "");
  });
  out.push("");

  if (d.verification.length > 0) {
    out.push("## Verification");
    for (const v of d.verification) {
      out.push(`- [ ] ${v.step}${v.command ? ` — ${inlineCode(v.command)}` : ""}${v.expected ? `\n  - Expected: ${v.expected}` : ""}`);
    }
    out.push("");
  }

  out.push("## Uncertainty", `**Confidence: ${d.confidence.level}.** ${d.confidence.rationale}`);
  if (d.confidence.adjustedReason) out.push("", `CrashCart adjustment: ${d.confidence.adjustedReason}`);
  if (d.alternatives.length > 0) {
    out.push("", "### Alternative explanations");
    for (const a of d.alternatives) {
      out.push(`- **${a.hypothesis}**${a.whyLessLikely ? ` — less likely because ${a.whyLessLikely}` : ""}${a.howToCheck ? ` Check: ${a.howToCheck}` : ""}`);
    }
  }
  if (d.unknowns.length > 0) {
    out.push("", "### Not visible in this log", ...d.unknowns.map((u) => `- ${u}`));
  }
  out.push("");

  if (d.warnings.length > 0) {
    out.push("## Warnings", ...d.warnings.map((w) => `- ${w.source === "crashcart" ? "**[CrashCart]** " : ""}${w.message}`), "");
  }

  out.push("## GitHub issue draft", `**Title:** ${d.githubIssue.title}`, "", fence(d.githubIssue.body, "markdown"), "");

  return out.join("\n");
}

/** Plain-text fix instructions for the "Copy fix" button. */
export function buildFixText(d: Diagnosis): string {
  const lines = [d.fix.summary, ""];
  d.fix.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.title}${step.detail ? ` — ${step.detail}` : ""}`);
    if (step.snippet) lines.push(step.snippet.content.replace(/^/gm, "   "));
  });
  if (d.verification.length > 0) {
    lines.push("", "Verify:");
    for (const v of d.verification) lines.push(`- ${v.step}${v.command ? `: ${v.command}` : ""}${v.expected ? ` (expected: ${v.expected})` : ""}`);
  }
  return lines.join("\n");
}
