import "server-only";
import type { EvidenceView } from "@/lib/schema/diagnosis";

const MIN_VERIFIABLE_CHARS = 8;
const MAX_SPAN_LINES = 8;
const NEAR_WINDOW = 3;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Remove wrapping quotes/backticks and any "12 | " prefix the model echoed. */
export function cleanQuote(quote: string): string {
  let q = quote.trim();
  const wrapped = q.match(/^(["'`])([\s\S]+)\1$/);
  if (wrapped) q = wrapped[2];
  return q.replace(/^\s*\d+\s*\|\s?/gm, "").trim();
}

export interface EvidenceInput {
  id: string;
  line?: number;
  quote: string;
  significance?: string;
}

/**
 * Check every quote against the analyzed log text. A quote is verified only if
 * its whitespace-normalized text appears in one line or a short run of
 * consecutive lines. The server computes line numbers; the model's line is
 * only a search hint.
 */
export function verifyEvidence(items: EvidenceInput[], analyzedText: string): EvidenceView[] {
  const lines = analyzedText.split("\n").map(squash);
  return items.map((item) => {
    const quote = cleanQuote(item.quote);
    const needle = squash(quote);
    const base = { id: item.id, quote, significance: item.significance };
    if (needle.length < MIN_VERIFIABLE_CHARS) {
      return { ...base, lineStart: null, lineEnd: null, verified: false, unverifiedReason: "too_short" as const };
    }
    const found = locate(lines, needle, item.line);
    return found
      ? { ...base, lineStart: found.start + 1, lineEnd: found.end + 1, verified: true }
      : { ...base, lineStart: null, lineEnd: null, verified: false, unverifiedReason: "not_found" as const };
  });
}

function locate(lines: string[], needle: string, hint?: number): { start: number; end: number } | null {
  const order = candidateOrder(lines.length, hint);
  for (const start of order) {
    let joined = "";
    for (let end = start; end < Math.min(lines.length, start + MAX_SPAN_LINES); end++) {
      joined = joined ? `${joined} ${lines[end]}` : lines[end];
      if (joined.includes(needle)) return { start: tighten(lines, needle, start, end), end };
      if (joined.length > needle.length + 400) break;
    }
  }
  return null;
}

/** Search near the cited line first, then the whole log top to bottom. */
function candidateOrder(count: number, hint?: number): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  if (hint && hint >= 1 && hint <= count) {
    const h = hint - 1;
    for (let d = 0; d <= NEAR_WINDOW; d++) {
      for (const i of d === 0 ? [h] : [h - d, h + d]) {
        if (i >= 0 && i < count && !seen.has(i)) {
          seen.add(i);
          order.push(i);
        }
      }
    }
  }
  for (let i = 0; i < count; i++) if (!seen.has(i)) order.push(i);
  return order;
}

/** Drop leading lines that aren't needed for the match, so lineStart is exact. */
function tighten(lines: string[], needle: string, start: number, end: number): number {
  let s = start;
  while (s < end && lines.slice(s + 1, end + 1).join(" ").includes(needle)) s++;
  return s;
}
