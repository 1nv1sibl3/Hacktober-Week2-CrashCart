import "server-only";
import { buildIssueBody } from "@/lib/report/github-issue";
import { countRedactions } from "@/lib/redact";
import { countLines } from "@/lib/input";
import { SCHEMA_VERSION, type Diagnosis, type ModelOutput, type Provenance } from "@/lib/schema/diagnosis";
import { verifyEvidence } from "./evidence";
import { scanRiskyCommands } from "./risky-commands";

export interface NormalizeContext {
  analyzedText: string;
  provenance: Provenance;
  now?: Date;
  id?: string;
}

/** Turn validated model output into the Diagnosis the UI renders. Adds only what the server can check. */
export function buildDiagnosis(out: ModelOutput, ctx: NormalizeContext): Diagnosis {
  // Stable, unique evidence ids: keep the model's "E<n>" ids, otherwise number by position.
  const used = new Set<string>();
  let next = out.evidence.length;
  const items = out.evidence.map((e, i) => {
    const proposed = e.id?.trim().toUpperCase();
    let id = proposed && /^E\d{1,3}$/.test(proposed) ? proposed : `E${i + 1}`;
    while (used.has(id)) id = `E${++next}`;
    used.add(id);
    return { id, line: e.line, quote: e.quote, significance: e.significance };
  });
  const evidence = verifyEvidence(items, ctx.analyzedText);

  const refs = out.rootCause.evidenceRefs.map((r) => r.trim().toUpperCase()).filter((r) => used.has(r));
  const verifiedIds = new Set(evidence.filter((e) => e.verified).map((e) => e.id));

  // Confidence guard: the model can't claim more certainty than its checkable evidence supports.
  const modelReportedLevel = out.confidence.level;
  let level = modelReportedLevel;
  let adjustedReason: string | undefined;
  if (verifiedIds.size === 0 && level !== "low") {
    level = "low";
    adjustedReason = "None of the quoted evidence could be found in your log, so CrashCart lowered confidence to low.";
  } else if (level === "high" && refs.length > 0 && refs.every((r) => !verifiedIds.has(r))) {
    level = "medium";
    adjustedReason = "The evidence cited for the root cause could not be found verbatim in your log, so CrashCart lowered confidence to medium.";
  }

  const warnings: Diagnosis["warnings"] = [];
  const commands = [
    ...out.fix.steps.flatMap((s) => (s.snippet ? [s.snippet.content] : [])),
    ...out.verification.flatMap((v) => (v.command ? [v.command] : [])),
  ];
  for (const message of scanRiskyCommands(commands)) warnings.push({ source: "crashcart", message: `Review before running: ${message}` });
  const unverifiedCount = evidence.filter((e) => !e.verified).length;
  if (unverifiedCount > 0) {
    warnings.push({
      source: "crashcart",
      message: `${unverifiedCount} quoted line${unverifiedCount === 1 ? "" : "s"} could not be found in your log or ${unverifiedCount === 1 ? "was" : "were"} too short to check. ${unverifiedCount === 1 ? "It is" : "They are"} shown separately; don't rely on ${unverifiedCount === 1 ? "it" : "them"}.`,
    });
  }
  for (const message of out.warnings) warnings.push({ source: "model", message });

  const base = {
    schemaVersion: SCHEMA_VERSION,
    id: ctx.id ?? crypto.randomUUID(),
    createdAt: (ctx.now ?? new Date()).toISOString(),
    summary: out.summary,
    category: out.category,
    ecosystem: out.ecosystem,
    severity: out.severity,
    rootCause: { statement: out.rootCause.statement, explanation: out.rootCause.explanation, evidenceIds: refs },
    confidence: { level, rationale: out.confidence.rationale, modelReportedLevel, ...(adjustedReason && { adjustedReason }) },
    evidence,
    fix: out.fix,
    verification: out.verification,
    alternatives: out.alternatives,
    unknowns: out.unknowns,
    warnings,
    provenance: ctx.provenance,
    input: {
      chars: ctx.analyzedText.length,
      lines: countLines(ctx.analyzedText),
      redactions: countRedactions(ctx.analyzedText).map(({ type, count }) => ({ type, count })),
      analyzedText: ctx.analyzedText,
    },
  } satisfies Omit<Diagnosis, "githubIssue">;

  const title = out.issueTitle ?? (out.summary.length > 100 ? `${out.summary.slice(0, 99)}…` : out.summary);
  return { ...base, githubIssue: { title, body: buildIssueBody(base) } };
}
