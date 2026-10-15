import { describe, expect, it } from "vitest";
import { cleanQuote, verifyEvidence } from "@/server/analysis/evidence";
import { extractJson } from "@/server/analysis/parse";

const LOG = [
  "$ docker compose up", // 1
  "api-1  | [db] connecting...", // 2
  "api-1  | Error: connect ECONNREFUSED 127.0.0.1:5432", // 3
  "api-1  |     at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16) {", // 4
  "api-1  |   code: 'ECONNREFUSED',", // 5
  "api-1 exited with code 1", // 6
  "db-1   | LOG:  database system is ready to accept connections", // 7
  "api-1  | [db] connecting...", // 8
].join("\n");

describe("verifyEvidence", () => {
  it("verifies an exact quote and computes its line", () => {
    const [e] = verifyEvidence([{ id: "E1", line: 3, quote: "Error: connect ECONNREFUSED 127.0.0.1:5432" }], LOG);
    expect(e).toMatchObject({ verified: true, lineStart: 3, lineEnd: 3 });
  });

  it("finds the real line even when the model cites the wrong one", () => {
    const [e] = verifyEvidence([{ id: "E1", line: 40, quote: "api-1 exited with code 1" }], LOG);
    expect(e).toMatchObject({ verified: true, lineStart: 6, lineEnd: 6 });
  });

  it("tolerates whitespace differences and an echoed line-number prefix", () => {
    const [a, b] = verifyEvidence(
      [
        { id: "E1", quote: "api-1 | Error: connect   ECONNREFUSED 127.0.0.1:5432" },
        { id: "E2", quote: "7 | db-1   | LOG:  database system is ready to accept connections" },
      ],
      LOG,
    );
    expect(a).toMatchObject({ verified: true, lineStart: 3 });
    expect(b).toMatchObject({ verified: true, lineStart: 7, quote: "db-1   | LOG:  database system is ready to accept connections" });
  });

  it("verifies a quote that spans consecutive lines", () => {
    const [e] = verifyEvidence(
      [{ id: "E1", quote: "Error: connect ECONNREFUSED 127.0.0.1:5432\napi-1  |     at TCPConnectWrap.afterConnect" }],
      LOG,
    );
    expect(e).toMatchObject({ verified: true, lineStart: 3, lineEnd: 4 });
  });

  it("does not verify fabricated or paraphrased quotes", () => {
    const [a, b] = verifyEvidence(
      [
        { id: "E1", line: 3, quote: "Error: connect ETIMEDOUT 10.0.0.5:5432" },
        { id: "E2", quote: "The API could not connect to the database" },
      ],
      LOG,
    );
    expect(a).toMatchObject({ verified: false, lineStart: null, lineEnd: null, unverifiedReason: "not_found" });
    expect(b.verified).toBe(false);
  });

  it("does not verify quotes too short to be meaningful, and says why", () => {
    const [e] = verifyEvidence([{ id: "E1", quote: "db:" }], LOG);
    expect(e).toMatchObject({ verified: false, unverifiedReason: "too_short" });
  });

  it("prefers the occurrence nearest the cited line", () => {
    const [e] = verifyEvidence([{ id: "E1", line: 8, quote: "api-1  | [db] connecting..." }], LOG);
    expect(e.lineStart).toBe(8);
  });

  it("cleanQuote strips wrapping quotes and line prefixes", () => {
    expect(cleanQuote('"12 | npm error code ERESOLVE"')).toBe("npm error code ERESOLVE");
    expect(cleanQuote("`ModuleNotFoundError: No module named 'dotenv'`")).toBe("ModuleNotFoundError: No module named 'dotenv'");
  });
});

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("parses JSON inside a markdown fence with surrounding prose", () => {
    expect(extractJson('Here you go:\n```json\n{"a": {"b": [1, 2]}}\n```\nHope that helps!')).toEqual({
      ok: true,
      value: { a: { b: [1, 2] } },
    });
  });

  it("drops <think> blocks before parsing", () => {
    expect(extractJson('<think>maybe {"wrong": true}</think>\n{"right": true}')).toEqual({ ok: true, value: { right: true } });
  });

  it("reports missing and broken JSON", () => {
    expect(extractJson("I could not analyze this.")).toMatchObject({ ok: false });
    const broken = extractJson('{"a": 1,');
    expect(broken.ok).toBe(false);
  });
});
