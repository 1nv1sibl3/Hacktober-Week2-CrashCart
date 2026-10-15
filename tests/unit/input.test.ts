import { describe, expect, it } from "vitest";
import { checkLog, countLines, keepLastChars, normalizeLog } from "@/lib/input";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe("normalizeLog", () => {
  it("converts CRLF, strips ANSI color and OSC sequences, and trims trailing spaces", () => {
    const raw = `npm ${ESC}[31mERR!${ESC}[39m code ERESOLVE  \r\n${ESC}]0;window title${BEL}line two\r\n\r\n`;
    expect(normalizeLog(raw)).toEqual({ text: "npm ERR! code ERESOLVE\nline two", ansiStripped: true });
  });

  it("reports when nothing was stripped and is idempotent", () => {
    const once = normalizeLog("a\nb  \n");
    expect(once).toEqual({ text: "a\nb", ansiStripped: false });
    expect(normalizeLog(once.text).text).toBe(once.text);
  });
});

describe("checkLog", () => {
  it("rejects empty and whitespace-only input", () => {
    expect(checkLog("", 100)).toMatchObject({ ok: false, code: "INPUT_EMPTY" });
    expect(checkLog(" \n\t ", 100)).toMatchObject({ ok: false, code: "INPUT_EMPTY" });
  });

  it("rejects input too short to diagnose", () => {
    expect(checkLog("error", 100)).toMatchObject({ ok: false, code: "INPUT_TOO_SHORT" });
  });

  it("rejects input over the limit with the sizes in the message", () => {
    const res = checkLog("x".repeat(1_001), 1_000);
    expect(res).toMatchObject({ ok: false, code: "INPUT_TOO_LARGE" });
    if (!res.ok) expect(res.message).toContain("1,001");
  });

  it("rejects binary data", () => {
    expect(checkLog(`${"x".repeat(30)}${String.fromCharCode(0)}`, 1_000)).toMatchObject({ ok: false, code: "INPUT_BINARY" });
    const noisy = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? String.fromCharCode(1) : "a")).join("");
    expect(checkLog(noisy, 1_000)).toMatchObject({ ok: false, code: "INPUT_BINARY" });
  });

  it("accepts a normal log", () => {
    expect(checkLog("Traceback (most recent call last):\n  File app.py", 1_000)).toEqual({ ok: true });
  });
});

describe("keepLastChars", () => {
  it("keeps the tail, starting on a line boundary", () => {
    const text = ["first line", "second line", "third line", "the error"].join("\n");
    const out = keepLastChars(text, 25);
    expect(out.length).toBeLessThanOrEqual(25);
    expect(out).toBe("third line\nthe error");
  });

  it("returns short text unchanged", () => {
    expect(keepLastChars("short", 100)).toBe("short");
  });
});

describe("countLines", () => {
  it("counts lines", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb\nc")).toBe(3);
  });
});
