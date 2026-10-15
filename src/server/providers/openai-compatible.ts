import "server-only";
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { CrashCartError, parseRetryAfterSeconds } from "@/server/errors";
import type { GenerateResult, ProviderAdapter } from "./types";

export interface OpenAICompatibleOptions {
  baseURL: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  jsonMode: boolean;
  supportsSystemRole: boolean;
  maxTokensParam: "max_tokens" | "max_completion_tokens";
  /** Injected in tests. */
  fetch?: typeof fetch;
}

/**
 * Works with any service exposing an OpenAI-style /chat/completions endpoint
 * (Ollama, xAI, vLLM, llama.cpp server, hosted inference providers). Sends only
 * the portable subset of parameters unless a capability flag says otherwise.
 */
export function createOpenAICompatibleAdapter(opts: OpenAICompatibleOptions): ProviderAdapter {
  const client = new OpenAI({
    baseURL: opts.baseURL,
    // Some local servers need no key, but the SDK requires a non-empty string.
    apiKey: opts.apiKey || "not-required",
    timeout: opts.timeoutMs,
    maxRetries: 0,
    ...(opts.fetch && { fetch: opts.fetch }),
  });

  return {
    jsonMode: opts.jsonMode,
    async generate(req): Promise<GenerateResult> {
      const messages: ChatCompletionMessageParam[] = opts.supportsSystemRole
        ? [{ role: "system", content: req.system }, ...req.messages]
        : req.messages.map((m, i) => (i === 0 ? { ...m, content: `${req.system}\n\n${m.content}` } : m));

      const body: Record<string, unknown> = {
        model: opts.model,
        messages,
        temperature: req.temperature,
        [opts.maxTokensParam]: req.maxOutputTokens,
      };
      if (req.useOptionalParams && opts.jsonMode) body.response_format = { type: "json_object" };

      try {
        const res = await client.chat.completions.create(body as unknown as ChatCompletionCreateParamsNonStreaming, {
          signal: req.signal,
        });
        const choice = res.choices?.[0];
        if (choice?.finish_reason === "content_filter") {
          throw new CrashCartError("CONTENT_BLOCKED", "finish_reason content_filter");
        }
        const content = choice?.message?.content;
        return {
          // Reasoning fields (e.g. reasoning_content) are ignored on purpose; <think> blocks are stripped in parse.ts.
          text: typeof content === "string" ? content : "",
          finishReason: choice?.finish_reason === "stop" ? "stop" : choice?.finish_reason === "length" ? "length" : "other",
          usage: { inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens },
        };
      } catch (err) {
        throw toCrashCartError(err);
      }
    },
  };
}

export function toCrashCartError(err: unknown): CrashCartError {
  if (err instanceof CrashCartError) return err;
  if (err instanceof APIUserAbortError) return new CrashCartError("TIMEOUT", "openai-compatible: request aborted");
  if (err instanceof APIConnectionTimeoutError) return new CrashCartError("TIMEOUT", "openai-compatible: timeout");
  if (err instanceof APIConnectionError) {
    // Usually "nothing is listening" (e.g. Ollama not running): not worth an automatic retry.
    return new CrashCartError("UNAVAILABLE", `openai-compatible: connection failed: ${err.message}`.slice(0, 300), {
      retryable: false,
      publicMessage: "Couldn't reach the model provider. Check that it is running and reachable from the server.",
    });
  }
  if (err instanceof APIError) {
    const msg = err.message ?? "";
    const status = err.status ?? 0;
    const detail = `openai-compatible HTTP ${status}: ${msg.slice(0, 300)}`;
    switch (true) {
      case status === 400 && /context length|maximum context|too many tokens|too long/i.test(msg):
        return new CrashCartError("CONTEXT_TOO_LONG", detail);
      case status === 400 && /response_format|json_object|json mode|max_completion_tokens|max_tokens|temperature/i.test(msg):
        return new CrashCartError("UNSUPPORTED_PARAM", detail);
      case status === 400 || status === 422:
        return new CrashCartError("BAD_REQUEST", detail, {
          publicMessage: "The provider rejected the request. Try again or pick another model.",
        });
      case status === 401 || status === 403:
        return new CrashCartError("AUTH_FAILED", detail);
      case status === 404:
        return new CrashCartError("NOT_CONFIGURED", detail, {
          publicMessage: "The provider doesn't recognize this model ID. The server's model configuration needs updating.",
        });
      case status === 429: {
        const header = Number.parseInt(err.headers?.get("retry-after") ?? "", 10);
        return new CrashCartError(/quota|insufficient|billing|per day|daily/i.test(msg) ? "QUOTA_EXHAUSTED" : "RATE_LIMITED", detail, {
          retryAfterSeconds: Number.isFinite(header) ? header : parseRetryAfterSeconds(msg),
        });
      }
      case status === 408 || status === 504:
        return new CrashCartError("TIMEOUT", detail);
      default:
        return new CrashCartError("UNAVAILABLE", detail, { retryable: status >= 500 });
    }
  }
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return new CrashCartError("TIMEOUT", `openai-compatible ${err.name}`);
  }
  return new CrashCartError("UNAVAILABLE", `openai-compatible: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
}
