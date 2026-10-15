import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";
import { CrashCartError, parseRetryAfterSeconds } from "@/server/errors";
import type { GenerateResult, ProviderAdapter } from "./types";

export interface GoogleAdapterOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  jsonMode: boolean;
  thinkingLevel?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

const THINKING_LEVELS = new Set<string>(Object.values(ThinkingLevel));
const BLOCKED_FINISH = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"]);

export function createGoogleAdapter(opts: GoogleAdapterOptions): ProviderAdapter {
  const ai = new GoogleGenAI({
    apiKey: opts.apiKey,
    httpOptions: {
      timeout: opts.timeoutMs,
      // The SDK retries only when retryOptions is set; pin it to one attempt. Retries are decided in analyze.ts.
      retryOptions: { attempts: 1 },
      ...(opts.fetch && { fetch: opts.fetch }),
    },
  });
  const thinkingLevel =
    opts.thinkingLevel && THINKING_LEVELS.has(opts.thinkingLevel) ? (opts.thinkingLevel as ThinkingLevel) : undefined;

  return {
    jsonMode: opts.jsonMode,
    async generate(req): Promise<GenerateResult> {
      const contents: Content[] = req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      try {
        const res = await ai.models.generateContent({
          model: opts.model,
          contents,
          config: {
            systemInstruction: req.system,
            temperature: req.temperature,
            maxOutputTokens: req.maxOutputTokens,
            abortSignal: req.signal,
            ...(req.useOptionalParams && opts.jsonMode && { responseMimeType: "application/json" }),
            ...(req.useOptionalParams && thinkingLevel && { thinkingConfig: { thinkingLevel } }),
          },
        });

        if (res.promptFeedback?.blockReason) {
          throw new CrashCartError("CONTENT_BLOCKED", `prompt blocked: ${res.promptFeedback.blockReason}`);
        }
        const candidate = res.candidates?.[0];
        const finish = String(candidate?.finishReason ?? "");
        if (BLOCKED_FINISH.has(finish)) throw new CrashCartError("CONTENT_BLOCKED", `finishReason ${finish}`);

        // Thought parts are returned even with thinking minimised; never use them.
        const text = (candidate?.content?.parts ?? [])
          .filter((p) => !p.thought && typeof p.text === "string")
          .map((p) => p.text)
          .join("");

        return {
          text,
          finishReason: finish === "STOP" ? "stop" : finish === "MAX_TOKENS" ? "length" : "other",
          usage: {
            inputTokens: res.usageMetadata?.promptTokenCount,
            outputTokens: res.usageMetadata?.candidatesTokenCount,
          },
        };
      } catch (err) {
        throw toCrashCartError(err);
      }
    },
  };
}

export function toCrashCartError(err: unknown): CrashCartError {
  if (err instanceof CrashCartError) return err;

  if (err instanceof ApiError) {
    const msg = err.message ?? "";
    const detail = `google HTTP ${err.status}: ${msg.slice(0, 300)}`;
    switch (true) {
      case err.status === 400 && /api[_ ]key[_ ]not[_ ]valid|API_KEY_INVALID/i.test(msg):
        return new CrashCartError("AUTH_FAILED", detail);
      case err.status === 400 && /input token count|exceeds the maximum number of tokens|context length|too long/i.test(msg):
        return new CrashCartError("CONTEXT_TOO_LONG", detail);
      case err.status === 400 && /response_?mime_?type|json mode|response_?schema|thinking/i.test(msg):
        return new CrashCartError("UNSUPPORTED_PARAM", detail);
      case err.status === 400:
        return new CrashCartError("BAD_REQUEST", detail, {
          publicMessage: "The provider rejected the request. Try again or pick another model.",
        });
      case err.status === 401 || err.status === 403:
        return new CrashCartError("AUTH_FAILED", detail);
      case err.status === 404:
        return new CrashCartError("NOT_CONFIGURED", detail, {
          publicMessage: "The provider doesn't recognize this model ID. The server's model configuration needs updating.",
        });
      case err.status === 429:
        return new CrashCartError(/PerDay|per day|daily/i.test(msg) ? "QUOTA_EXHAUSTED" : "RATE_LIMITED", detail, {
          retryAfterSeconds: parseRetryAfterSeconds(msg),
        });
      case err.status === 408 || err.status === 504:
        return new CrashCartError("TIMEOUT", detail);
      default:
        return new CrashCartError("UNAVAILABLE", detail, { retryable: err.status >= 500 });
    }
  }

  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return new CrashCartError("TIMEOUT", `google ${err.name}`);
  }
  return new CrashCartError("UNAVAILABLE", `google: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
}
