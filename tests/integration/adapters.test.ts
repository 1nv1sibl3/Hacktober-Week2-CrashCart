import { describe, expect, it } from "vitest";
import { createGoogleAdapter } from "@/server/providers/google";
import { createOpenAICompatibleAdapter } from "@/server/providers/openai-compatible";
import type { GenerateRequest } from "@/server/providers/types";
import { CrashCartError } from "@/server/errors";

// Real SDKs, fake network: each test injects a fetch that returns canned HTTP responses.

type Captured = { url: string; body: Record<string, unknown> };

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const captured: Captured[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input instanceof Request ? input.url : input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
  return { fn, captured };
}

const hangingFetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")));
  })) as typeof fetch;

const request = (overrides: Partial<GenerateRequest> = {}): GenerateRequest => ({
  system: "SYSTEM PROMPT",
  messages: [{ role: "user", content: "LOG" }],
  maxOutputTokens: 1000,
  temperature: 0.2,
  useOptionalParams: true,
  ...overrides,
});

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(CrashCartError);
    return e as CrashCartError;
  }
  throw new Error("expected a CrashCartError");
}

const geminiOk = (parts: unknown[], finishReason = "STOP") => ({
  candidates: [{ content: { role: "model", parts }, finishReason }],
  usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 600, thoughtsTokenCount: 0 },
});

const googleError = (code: number, status: string, message: string, details: unknown[] = []) => ({
  error: { code, message, status, details },
});

describe("Google adapter (@google/genai with fake fetch)", () => {
  const make = (fetchFn: typeof fetch, extra: { jsonMode?: boolean; thinkingLevel?: string; timeoutMs?: number } = {}) =>
    createGoogleAdapter({
      apiKey: "test-key",
      model: "gemma-4-26b-a4b-it",
      timeoutMs: extra.timeoutMs ?? 5_000,
      jsonMode: extra.jsonMode ?? true,
      thinkingLevel: extra.thinkingLevel ?? "MINIMAL",
      fetch: fetchFn,
    });

  it("returns only non-thought text and token usage", async () => {
    const f = fakeFetch(200, geminiOk([{ text: "private reasoning", thought: true }, { text: '{"ok":' }, { text: "true}" }]));
    const res = await make(f.fn).generate(request());
    expect(res).toEqual({ text: '{"ok":true}', finishReason: "stop", usage: { inputTokens: 800, outputTokens: 600 } });
  });

  it("sends the system instruction, JSON mode, and minimal thinking to the right model", async () => {
    const f = fakeFetch(200, geminiOk([{ text: "{}" }]));
    await make(f.fn).generate(request());
    const { url, body } = f.captured[0];
    expect(url).toContain("models/gemma-4-26b-a4b-it:generateContent");
    expect(JSON.stringify(body.systemInstruction)).toContain("SYSTEM PROMPT");
    expect(body.generationConfig).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 1000,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    });
  });

  it("omits optional parameters when asked to send the portable request", async () => {
    const f = fakeFetch(200, geminiOk([{ text: "{}" }]));
    await make(f.fn).generate(request({ useOptionalParams: false }));
    const config = f.captured[0].body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBeUndefined();
    expect(config.thinkingConfig).toBeUndefined();
  });

  it("maps the assistant turn of a repair conversation to the model role", async () => {
    const f = fakeFetch(200, geminiOk([{ text: "{}" }]));
    await make(f.fn).generate(
      request({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] }),
    );
    const contents = f.captured[0].body.contents as { role: string }[];
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("reports truncation and safety blocks", async () => {
    const truncated = await make(fakeFetch(200, geminiOk([{ text: "{" }], "MAX_TOKENS")).fn).generate(request());
    expect(truncated.finishReason).toBe("length");
    const blocked = await codeOf(make(fakeFetch(200, geminiOk([], "SAFETY")).fn).generate(request()));
    expect(blocked.code).toBe("CONTENT_BLOCKED");
  });

  it("distinguishes per-minute rate limits from daily quota exhaustion", async () => {
    const perMinute = googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded for metric: GenerateRequestsPerMinutePerProjectPerModel-FreeTier", [
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" },
    ]);
    const perDay = googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier");
    const a = await codeOf(make(fakeFetch(429, perMinute).fn).generate(request()));
    expect(a.code).toBe("RATE_LIMITED");
    expect(a.retryAfterSeconds).toBe(37);
    const b = await codeOf(make(fakeFetch(429, perDay).fn).generate(request()));
    expect(b.code).toBe("QUOTA_EXHAUSTED");
  });

  it.each([
    [500, "INTERNAL", "Internal error encountered.", "UNAVAILABLE", true],
    [503, "UNAVAILABLE", "The model is overloaded.", "UNAVAILABLE", true],
    [504, "DEADLINE_EXCEEDED", "Deadline expired before operation could complete.", "TIMEOUT", true],
    [400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", "AUTH_FAILED", false],
    [403, "PERMISSION_DENIED", "Permission denied.", "AUTH_FAILED", false],
    [404, "NOT_FOUND", "models/gemma-x is not found", "NOT_CONFIGURED", false],
  ])("maps HTTP %i %s to %s", async (status, grpc, message, code, retryable) => {
    const err = await codeOf(make(fakeFetch(status, googleError(status, grpc, message)).fn).generate(request()));
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
  });

  it("makes exactly one HTTP request even on a retryable error (no hidden SDK retries)", async () => {
    const f = fakeFetch(500, googleError(500, "INTERNAL", "Internal error encountered."));
    await codeOf(make(f.fn).generate(request()));
    expect(f.captured).toHaveLength(1);
  });

  it("times out", async () => {
    const err = await codeOf(make(hangingFetch, { timeoutMs: 50 }).generate(request()));
    expect(err.code).toBe("TIMEOUT");
  });
});

describe("OpenAI-compatible adapter (openai SDK with fake fetch)", () => {
  const chatOk = (content: string, finish = "stop") => ({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
    usage: { prompt_tokens: 700, completion_tokens: 300, total_tokens: 1000 },
  });
  const make = (
    fetchFn: typeof fetch,
    extra: Partial<{ jsonMode: boolean; supportsSystemRole: boolean; maxTokensParam: "max_tokens" | "max_completion_tokens"; timeoutMs: number }> = {},
  ) =>
    createOpenAICompatibleAdapter({
      baseURL: "https://inference.example.invalid/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: extra.timeoutMs ?? 5_000,
      jsonMode: extra.jsonMode ?? true,
      supportsSystemRole: extra.supportsSystemRole ?? true,
      maxTokensParam: extra.maxTokensParam ?? "max_tokens",
      fetch: fetchFn,
    });

  it("sends a portable chat request with optional JSON mode and returns the text", async () => {
    const f = fakeFetch(200, chatOk('{"a":1}'));
    const res = await make(f.fn).generate(request());
    expect(res).toEqual({ text: '{"a":1}', finishReason: "stop", usage: { inputTokens: 700, outputTokens: 300 } });
    const { url, body } = f.captured[0];
    expect(url).toBe("https://inference.example.invalid/v1/chat/completions");
    expect(body).toMatchObject({
      model: "test-model",
      temperature: 0.2,
      max_tokens: 1000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "SYSTEM PROMPT" },
        { role: "user", content: "LOG" },
      ],
    });
  });

  it("drops JSON mode for the portable request and honours capability flags", async () => {
    const f = fakeFetch(200, chatOk("{}"));
    await make(f.fn, { supportsSystemRole: false, maxTokensParam: "max_completion_tokens" }).generate(request({ useOptionalParams: false }));
    const body = f.captured[0].body;
    expect(body.response_format).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBe(1000);
    expect(body.messages).toEqual([{ role: "user", content: "SYSTEM PROMPT\n\nLOG" }]);
  });

  it("maps a rejected response_format to UNSUPPORTED_PARAM", async () => {
    const f = fakeFetch(400, { error: { message: "Unrecognized request argument supplied: response_format", type: "invalid_request_error" } });
    expect((await codeOf(make(f.fn).generate(request()))).code).toBe("UNSUPPORTED_PARAM");
  });

  it("maps rate limits with Retry-After, auth errors, and server errors", async () => {
    const limited = await codeOf(make(fakeFetch(429, { error: { message: "Rate limit reached" } }, { "retry-after": "7" }).fn).generate(request()));
    expect(limited).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 7 });
    expect((await codeOf(make(fakeFetch(401, { error: { message: "Invalid API key" } }).fn).generate(request()))).code).toBe("AUTH_FAILED");
    const server = await codeOf(make(fakeFetch(502, { error: { message: "Bad gateway" } }).fn).generate(request()));
    expect(server).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  });

  it("reports an unreachable provider as non-retryable UNAVAILABLE", async () => {
    const refused = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await codeOf(make(refused).generate(request()))).toMatchObject({ code: "UNAVAILABLE", retryable: false });
  });

  it("reports content-filtered replies and truncation", async () => {
    expect((await codeOf(make(fakeFetch(200, chatOk("", "content_filter")).fn).generate(request()))).code).toBe("CONTENT_BLOCKED");
    expect((await make(fakeFetch(200, chatOk("{", "length")).fn).generate(request())).finishReason).toBe("length");
  });

  it("times out", async () => {
    expect((await codeOf(make(hangingFetch, { timeoutMs: 50 }).generate(request()))).code).toBe("TIMEOUT");
  });
});
