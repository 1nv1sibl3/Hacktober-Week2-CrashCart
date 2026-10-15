import "server-only";

export type JsonExtraction = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Pull one JSON object out of a model reply. Handles markdown fences, leading or
 * trailing prose, and <think> blocks from reasoning models (which are discarded).
 */
export function extractJson(reply: string): JsonExtraction {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { ok: false, reason: "the reply did not contain a JSON object." };
  }
  try {
    return { ok: true, value: JSON.parse(text.slice(start, end + 1)) };
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 120) : "parse error";
    return { ok: false, reason: `the JSON could not be parsed (${detail}).` };
  }
}
