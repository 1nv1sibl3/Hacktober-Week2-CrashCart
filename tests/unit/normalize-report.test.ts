import { describe, expect, it } from "vitest";
import { normalizeLog } from "@/lib/input";
import { redact } from "@/lib/redact";
import { fence, inlineCode } from "@/lib/report/fence";
import { buildFixText, buildMarkdownReport } from "@/lib/report/markdown";
import { ModelOutputSchema, type Provenance } from "@/lib/schema/diagnosis";
import { buildDiagnosis } from "@/server/analysis/normalize";
import { scanRiskyCommands } from "@/server/analysis/risky-commands";
import { DOCKER_LOG, validModelOutput } from "../helpers";

const analyzedText = redact(normalizeLog(DOCKER_LOG).text).text;
const provenance: Provenance = {
  providerId: "google",
  providerLabel: "Google AI Studio",
  modelId: "gemma-4-26b-a4b-it",
  modelLabel: "Gemma 4 26B A4B",
  openWeight: true,
  license: "Apache-2.0",
  hosting: "hosted",
  durationMs: 12_345,
  attempts: 1,
  jsonMode: true,
};

function diagnose(overrides: Record<string, unknown> = {}) {
  return buildDiagnosis(ModelOutputSchema.parse(validModelOutput(overrides)), {
    analyzedText,
    provenance,
    now: new Date("2026-10-15T12:00:00Z"),
    id: "test-id",
  });
}

describe("buildDiagnosis", () => {
  it("verifies evidence against the redacted log and keeps high confidence when it checks out", () => {
    const d = diagnose();
    expect(d.evidence.every((e) => e.verified)).toBe(true);
    expect(d.confidence).toEqual(expect.objectContaining({ level: "high", modelReportedLevel: "high" }));
    expect(d.confidence.adjustedReason).toBeUndefined();
    expect(d.input.redactions).toEqual([
      { type: "URL_PASSWORD", count: 2 },
      { type: "SECRET", count: 1 },
    ]);
    expect(d.provenance.modelId).toBe("gemma-4-26b-a4b-it");
  });

  it("drops confidence to low when no evidence can be found in the log", () => {
    const d = diagnose({ evidence: [{ id: "E1", quote: "FATAL: role app does not exist at all" }] });
    expect(d.confidence.level).toBe("low");
    expect(d.confidence.modelReportedLevel).toBe("high");
    expect(d.confidence.adjustedReason).toMatch(/lowered confidence to low/);
    expect(d.warnings.some((w) => w.source === "crashcart" && /could not be found/.test(w.message))).toBe(true);
  });

  it("drops high to medium when only the root cause's cited evidence is unverified", () => {
    const d = diagnose({
      rootCause: { statement: "s", evidenceRefs: ["E2"] },
      evidence: [
        { id: "E1", quote: "api-1  | Error: connect ECONNREFUSED 127.0.0.1:5432" },
        { id: "E2", quote: "the database rejected the password for app" },
      ],
    });
    expect(d.confidence.level).toBe("medium");
    expect(d.evidence.map((e) => e.verified)).toEqual([true, false]);
  });

  it("ignores root-cause references to evidence ids that don't exist", () => {
    const d = diagnose({ rootCause: { statement: "s", evidenceRefs: ["E1", "E9", "nonsense"] } });
    expect(d.rootCause.evidenceIds).toEqual(["E1"]);
  });

  it("gives evidence unique E-numbered ids", () => {
    const d = diagnose({
      evidence: [
        { id: "E1", quote: "api-1 exited with code 1" },
        { id: "E1", quote: "database system is ready to accept connections" },
        { id: "first", quote: "api-1  | [db] connecting..." },
      ],
    });
    const ids = d.evidence.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => /^E\d+$/.test(id))).toBe(true);
  });

  it("flags risky commands in snippets and verification commands, not in prose", () => {
    const d = diagnose({
      fix: {
        summary: "Don't use --force; fix the dependency instead.",
        steps: [{ title: "Reinstall", detail: "Avoid --legacy-peer-deps.", snippet: { language: "bash", content: "rm -rf node_modules && npm install" } }],
      },
      verification: [{ step: "Clean Docker", command: "docker system prune -a" }],
    });
    const messages = d.warnings.filter((w) => w.source === "crashcart").map((w) => w.message);
    expect(messages.some((m) => m.includes("rm -rf"))).toBe(true);
    expect(messages.some((m) => m.includes("Docker data"))).toBe(true);
    expect(messages.some((m) => m.includes("--legacy-peer-deps"))).toBe(false);
    expect(messages.some((m) => m.includes("`--force`"))).toBe(false);
  });

  it("builds a GitHub issue from validated fields only", () => {
    const d = diagnose();
    expect(d.githubIssue.title).toBe("api exits with ECONNREFUSED because DATABASE_URL uses localhost");
    expect(d.githubIssue.body).toContain("## Summary");
    expect(d.githubIssue.body).toContain("api-1  | Error: connect ECONNREFUSED 127.0.0.1:5432");
    expect(d.githubIssue.body).toContain("Gemma 4 26B A4B (open-weight, Apache-2.0) via Google AI Studio");
    expect(d.githubIssue.body).toContain("not yet verified");
    expect(d.githubIssue.body).not.toContain("SuperSecret123");
  });

  it("falls back to the summary when the model gives no issue title", () => {
    const d = diagnose({ issueTitle: undefined });
    expect(d.githubIssue.title).toBe(d.summary);
  });
});

describe("scanRiskyCommands", () => {
  it.each([
    ["curl -fsSL https://example.com/install.sh | sh", "Piping"],
    ["sudo npm install -g pnpm", "sudo"],
    ["npm install --legacy-peer-deps", "legacy-peer-deps"],
    ["chmod -R 777 /var/www", "chmod 777"],
    ["git push origin main --force", "Force-pushing"],
    ["git reset --hard HEAD~1", "discards"],
    ["DROP TABLE users;", "destroys"],
    ["pip install --break-system-packages requests", "break-system-packages"],
  ])("flags %s", (cmd, fragment) => {
    expect(scanRiskyCommands([cmd]).join(" ")).toContain(fragment);
  });

  it("passes safe commands", () => {
    expect(scanRiskyCommands(["npm install", "python -m pip install python-dotenv", "docker compose logs api"])).toEqual([]);
  });
});

describe("report generation", () => {
  it("fence() always outlasts backticks in the content", () => {
    expect(fence("plain", "bash")).toBe("```bash\nplain\n```");
    expect(fence("before ``` inside", "md")).toBe("````md\nbefore ``` inside\n````");
    expect(inlineCode("a `b` c")).toBe("``a `b` c``");
  });

  it("builds a Markdown report with every section and the provenance", () => {
    const d = diagnose({
      evidence: [
        { id: "E1", quote: "api-1  | Error: connect ECONNREFUSED 127.0.0.1:5432" },
        { id: "E2", quote: "made up line with ``` backticks inside" },
      ],
      alternatives: [{ hypothesis: "Postgres not started yet", whyLessLikely: "db reports ready", howToCheck: "docker compose ps" }],
      unknowns: ["Whether a .env file overrides DATABASE_URL"],
    });
    const md = buildMarkdownReport(d);
    for (const heading of ["# CrashCart debugging report", "## Summary", "## Likely root cause", "## Evidence", "## Suggested fix", "## Verification", "## Uncertainty", "## GitHub issue draft"]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("Gemma 4 26B A4B (open-weight, Apache-2.0) via Google AI Studio");
    expect(md).toContain("### ⚠ Quotes not found in the log");
    expect(md).toContain("````text\nmade up line with ``` backticks inside\n````");
    expect(md).toContain("Postgres not started yet");
    expect(md).toContain("12.3 s (1 model call)");
  });

  it("builds plain-text fix instructions", () => {
    const text = buildFixText(diagnose());
    expect(text).toContain("1. Point DATABASE_URL at the db service");
    expect(text).toContain("   DATABASE_URL: postgres://app:${DB_PASSWORD}@db:5432/shop");
    expect(text).toContain("Verify:");
  });
});
