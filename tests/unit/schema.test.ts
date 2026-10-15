import { describe, expect, it } from "vitest";
import { ModelOutputSchema } from "@/lib/schema/diagnosis";
import { validModelOutput } from "../helpers";

describe("ModelOutputSchema", () => {
  it("accepts a complete, valid reply", () => {
    const res = ModelOutputSchema.safeParse(validModelOutput());
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.category).toBe("container");
      expect(res.data.evidence).toHaveLength(2);
      expect(res.data.fix.steps[0].snippet?.language).toBe("yaml");
    }
  });

  it("normalizes enum spelling and falls back for unknown values", () => {
    const res = ModelOutputSchema.parse(
      validModelOutput({ category: "Import-Module", ecosystem: "NODE", severity: "catastrophic", confidence: { level: "HIGH", rationale: "x" } }),
    );
    expect(res.category).toBe("import_module");
    expect(res.ecosystem).toBe("node");
    expect(res.severity).toBe("unknown");
    expect(res.confidence.level).toBe("high");
  });

  it("requires summary, root cause, confidence, evidence, and fix", () => {
    for (const key of ["summary", "rootCause", "confidence", "evidence", "fix"]) {
      const reply = validModelOutput();
      delete (reply as Record<string, unknown>)[key];
      expect(ModelOutputSchema.safeParse(reply).success, key).toBe(false);
    }
  });

  it("rejects a reply with no usable evidence", () => {
    const res = ModelOutputSchema.safeParse(validModelOutput({ evidence: [{ id: "E1", quote: "" }] }));
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].message).toContain("evidence");
  });

  it("drops malformed list items instead of failing the whole reply", () => {
    const res = ModelOutputSchema.parse(
      validModelOutput({
        evidence: [{ id: "E1", quote: "valid quote here" }, { id: "E2" }, "not an object"],
        verification: [{ step: "ok" }, { command: "no step" }],
        alternatives: null,
      }),
    );
    expect(res.evidence.map((e) => e.id)).toEqual(["E1"]);
    expect(res.verification).toEqual([{ step: "ok", command: undefined, expected: undefined }]);
    expect(res.alternatives).toEqual([]);
  });

  it("keeps a fix step whose snippet is malformed, without the snippet", () => {
    const res = ModelOutputSchema.parse(
      validModelOutput({ fix: { summary: "s", steps: [{ title: "Do it", snippet: { language: "bash" } }] } }),
    );
    expect(res.fix.steps).toEqual([{ title: "Do it", detail: undefined, snippet: undefined }]);
  });

  it("defaults optional arrays and clips long text", () => {
    const reply = validModelOutput({ summary: "s".repeat(2_000) });
    for (const k of ["verification", "alternatives", "unknowns", "warnings", "issueTitle"]) {
      delete (reply as Record<string, unknown>)[k];
    }
    const res = ModelOutputSchema.parse(reply);
    expect(res.summary.length).toBe(500);
    expect(res.unknowns).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.issueTitle).toBeUndefined();
  });

  it("reads line numbers given as strings and ignores invalid ones", () => {
    const res = ModelOutputSchema.parse(
      validModelOutput({ evidence: [{ quote: "quote one here", line: "12" }, { quote: "quote two here", line: -3 }] }),
    );
    expect(res.evidence.map((e) => e.line)).toEqual([12, undefined]);
  });
});
