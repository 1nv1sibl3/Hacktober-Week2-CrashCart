// Log normalization and validation. Isomorphic: runs in the browser for the live
// preview and on the server as the authoritative check.

export const MIN_INPUT_CHARS = 20;
export const DEFAULT_MAX_INPUT_CHARS = 30_000;

// Built from escaped strings so the source stays plain ASCII.
const ESC = "\\u001b";
const BEL = "\\u0007";
// CSI sequences (colors, cursor moves) and OSC sequences (window titles, hyperlinks).
const ANSI_PATTERN = new RegExp(
  `${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
  "g",
);
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");
const NUL = String.fromCharCode(0);

export interface NormalizedLog {
  text: string;
  ansiStripped: boolean;
}

/** CRLF → LF, strip ANSI escapes, drop trailing spaces and surrounding blank lines. Idempotent. */
export function normalizeLog(raw: string): NormalizedLog {
  const unixed = raw.replace(/\r\n?/g, "\n");
  const stripped = unixed.replace(ANSI_PATTERN, "");
  const text = stripped.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, "");
  return { text, ansiStripped: stripped.length !== unixed.length };
}

export type InputErrorCode = "INPUT_EMPTY" | "INPUT_TOO_SHORT" | "INPUT_TOO_LARGE" | "INPUT_BINARY";

export type InputCheck = { ok: true } | { ok: false; code: InputErrorCode; message: string };

export function checkLog(text: string, maxChars: number): InputCheck {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, code: "INPUT_EMPTY", message: "Paste a log, stack trace, or build output to analyze." };
  }
  if (trimmed.length < MIN_INPUT_CHARS) {
    return {
      ok: false,
      code: "INPUT_TOO_SHORT",
      message: "That's too short to diagnose. Paste the full error output, including the lines around it.",
    };
  }
  if (text.length > maxChars) {
    return {
      ok: false,
      code: "INPUT_TOO_LARGE",
      message: `The log is ${text.length.toLocaleString("en-US")} characters; the limit is ${maxChars.toLocaleString("en-US")}. Trim it to the part around the error.`,
    };
  }
  if (text.includes(NUL) || (text.match(CONTROL_CHARS)?.length ?? 0) > text.length * 0.05) {
    return { ok: false, code: "INPUT_BINARY", message: "This looks like binary data, not a text log." };
  }
  return { ok: true };
}

/** Keep the last `maxChars` characters, starting at a line boundary (errors usually sit at the end). */
export function keepLastChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const tail = text.slice(-maxChars);
  const firstBreak = tail.indexOf("\n");
  return firstBreak === -1 ? tail : tail.slice(firstBreak + 1);
}

export function countLines(text: string): number {
  return text ? text.split("\n").length : 0;
}
