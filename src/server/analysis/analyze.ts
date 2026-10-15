import "server-only";
import { checkLog, normalizeLog } from "@/lib/input";
import { redact } from "@/lib/redact";
import { ModelOutputSchema, type Diagnosis, type ModelOutput } from "@/lib/schema/diagnosis";
import { getConfig, type AppConfig } from "@/server/env";
import { CrashCartError } from "@/server/errors";
import { findSelection, resolveProviders, type ResolvedProvider } from "@/server/providers/catalog";
import { createAdapter as defaultCreateAdapter, type AdapterFactory } from "@/server/providers/registry";
import type { ChatMessage, GenerateResult } from "@/server/providers/types";
import { buildDiagnosis } from "./normalize";
import { extractJson } from "./parse";
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt, newNonce } from "./prompt";

/**
 * Call budget per analysis:
 * - at most MAX_GENERATIONS model replies: the original plus one repair OR one retry without optional params;
 * - plus at most MAX_TRANSIENT_RETRIES same-model retries after a fast, retryable server error (HTTP 500/503).
 *   The Gemma free tier returned such errors on ~half of calls in testing (docs/TESTING.md); they fail in ~1 s
 *   and produce no output. Worst case: 4 HTTP requests. Rate limits, quota, auth, and timeouts are never retried.
 */
export const MAX_GENERATIONS = 2;
export const MAX_TRANSIENT_RETRIES = 2;
export const MAX_MODEL_CALLS = MAX_GENERATIONS + MAX_TRANSIENT_RETRIES;
/** Don't start a transient retry this late; the route's maxDuration is 120 s. */
const TRANSIENT_RETRY_WINDOW_MS = 40_000;
const MAX_OUTPUT_TOKENS = 4096;
const TEMPERATURE = 0.2;

export interface AnalyzeInput {
  log: string;
  providerId: string;
  modelId: string;
  signal?: AbortSignal;
}

export interface AnalyzeDeps {
  config?: AppConfig;
  providers?: ResolvedProvider[];
  createAdapter?: AdapterFactory;
  /** Base backoff before a transient retry (n-th retry waits n × this). Tests pass 0. */
  retryBackoffMs?: number;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new CrashCartError("TIMEOUT", "aborted during retry backoff"));
      },
      { once: true },
    );
  });
}

type Interpretation = { ok: true; output: ModelOutput } | { ok: false; detail: string; repairPrompt: string };

function interpret(result: GenerateResult): Interpretation {
  if (result.finishReason === "length") {
    return {
      ok: false,
      detail: "reply truncated (max tokens)",
      repairPrompt: buildRepairPrompt("it was cut off before the JSON object was complete. Keep every field brief."),
    };
  }
  const json = extractJson(result.text);
  if (!json.ok) return { ok: false, detail: json.reason, repairPrompt: buildRepairPrompt(json.reason) };

  const parsed = ModelOutputSchema.safeParse(json.value);
  if (parsed.success) return { ok: true, output: parsed.data };

  const issues = parsed.error.issues
    .slice(0, 10)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  return {
    ok: false,
    detail: `schema validation failed:\n${issues}`,
    repairPrompt: buildRepairPrompt(`it did not match the required shape:\n${issues}`),
  };
}

/**
 * The whole pipeline: normalize → validate → redact → call the selected model →
 * parse → validate → (≤1 repair; ≤2 same-model transient retries) → verify evidence → Diagnosis.
 * Never switches models and never fabricates output.
 */
export async function analyzeLog(input: AnalyzeInput, deps: AnalyzeDeps = {}): Promise<Diagnosis> {
  const config = deps.config ?? getConfig();
  const providers = deps.providers ?? resolveProviders();

  const normalized = normalizeLog(input.log).text;
  const redacted = redact(normalized).text;
  // Validate what will actually be sent (redaction tokens can lengthen the text).
  const check = checkLog(redacted, config.maxInputChars);
  if (!check.ok) throw new CrashCartError(check.code, check.code, { publicMessage: check.message });

  const selection = findSelection(providers, input.providerId, input.modelId);
  if (!selection) throw new CrashCartError("NOT_CONFIGURED", `unknown selection ${input.providerId}/${input.modelId}`);
  const { provider, model } = selection;
  const adapter = (deps.createAdapter ?? defaultCreateAdapter)(provider, model, config.timeoutMs);

  const system = buildSystemPrompt();
  const firstTurn: ChatMessage[] = [{ role: "user", content: buildUserPrompt(redacted, newNonce()) }];
  const backoffMs = deps.retryBackoffMs ?? 1_000;
  let useOptionalParams = true;
  let calls = 0;
  let transientRetries = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();

  /** One model reply. Fast transient server errors are retried on the same model, within the shared budget. */
  const call = async (messages: ChatMessage[]): Promise<GenerateResult> => {
    for (;;) {
      calls += 1;
      try {
        const result = await adapter.generate({
          system,
          messages,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: TEMPERATURE,
          useOptionalParams,
          signal: input.signal,
        });
        usage.inputTokens += result.usage?.inputTokens ?? 0;
        usage.outputTokens += result.usage?.outputTokens ?? 0;
        return result;
      } catch (err) {
        const transient = err instanceof CrashCartError && err.code === "UNAVAILABLE" && err.retryable;
        if (!transient || transientRetries >= MAX_TRANSIENT_RETRIES || Date.now() - started > TRANSIENT_RETRY_WINDOW_MS) {
          throw err;
        }
        transientRetries += 1;
        await sleep(backoffMs * transientRetries, input.signal);
      }
    }
  };

  // Generation 1 (or, if the provider rejects an optional parameter, its portable replacement).
  let secondGenerationUsed = false;
  let result: GenerateResult;
  try {
    result = await call(firstTurn);
  } catch (err) {
    if (!(err instanceof CrashCartError) || err.code !== "UNSUPPORTED_PARAM") throw err;
    useOptionalParams = false;
    secondGenerationUsed = true;
    result = await call(firstTurn);
  }

  // Generation 2: one repair turn for an unusable reply.
  let interpretation = interpret(result);
  if (!interpretation.ok) {
    if (secondGenerationUsed) throw new CrashCartError("MODEL_OUTPUT_INVALID", interpretation.detail);
    const repairTurn: ChatMessage[] = [
      ...firstTurn,
      { role: "assistant", content: result.text.trim() || "(empty reply)" },
      { role: "user", content: interpretation.repairPrompt },
    ];
    interpretation = interpret(await call(repairTurn));
    if (!interpretation.ok) throw new CrashCartError("MODEL_OUTPUT_INVALID", interpretation.detail);
  }

  return buildDiagnosis(interpretation.output, {
    analyzedText: redacted,
    provenance: {
      providerId: provider.id,
      providerLabel: provider.label,
      modelId: model.id,
      modelLabel: model.label,
      openWeight: model.openWeight,
      ...(model.license ? { license: model.license } : {}),
      hosting: provider.hosting,
      durationMs: Date.now() - started,
      attempts: calls,
      jsonMode: adapter.jsonMode && useOptionalParams,
      usage: {
        ...(usage.inputTokens ? { inputTokens: usage.inputTokens } : {}),
        ...(usage.outputTokens ? { outputTokens: usage.outputTokens } : {}),
      },
    },
  });
}
