import "server-only";
import type { PublicProvider } from "@/lib/schema/diagnosis";
import { bool, csv, type AppConfig, type Env } from "@/server/env";

// Provider catalog. Committed to the repo and contains no secrets: each entry
// reads its own env vars and is "available" only when they are set.
// To add a provider, add one entry to PROVIDERS.

export type ProviderKind = "google" | "openai-compatible";

export interface ModelInfo {
  id: string;
  label: string;
  openWeight: boolean;
  license?: string;
}

export interface ResolvedProvider {
  id: string;
  label: string;
  kind: ProviderKind;
  hosting: "hosted" | "local";
  dataNotice: string;
  models: ModelInfo[];
  apiKey?: string;
  baseURL?: string;
  jsonMode: boolean;
  supportsSystemRole: boolean;
  maxTokensParam: "max_tokens" | "max_completion_tokens";
  /** Google only: e.g. "MINIMAL". Unset → API default. */
  thinkingLevel?: string;
}

interface ProviderDefinition {
  id: string;
  resolve(env: Env): ResolvedProvider | null;
}

const MODEL_LABELS: Record<string, string> = {
  "gemma-4-26b-a4b-it": "Gemma 4 26B A4B",
  "gemma-4-31b-it": "Gemma 4 31B",
};

const labelFor = (id: string) => MODEL_LABELS[id] ?? id;

/** Gemma 4 weights are Apache-2.0; other model licenses are not assumed. */
const licenseFor = (id: string) => (/^gemma-?4\b|^gemma4\b/i.test(id) ? "Apache-2.0" : undefined);

const isLocalUrl = (url: string) => /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?\//i.test(`${url}/`);

const PROVIDERS: ProviderDefinition[] = [
  {
    id: "google",
    resolve(env) {
      const apiKey = env.GEMINI_API_KEY?.trim();
      if (!apiKey) return null;
      const gemma = csv(env.GOOGLE_GEMMA_MODELS || "gemma-4-26b-a4b-it").map((id) => ({
        id,
        label: labelFor(id),
        openWeight: true,
        license: licenseFor(id),
      }));
      const gemini = csv(env.GOOGLE_GEMINI_MODELS).map((id) => ({ id, label: labelFor(id), openWeight: false }));
      const models = [...gemma, ...gemini];
      if (models.length === 0) return null;
      return {
        id: "google",
        label: "Google AI Studio",
        kind: "google",
        hosting: "hosted",
        dataNotice:
          "Your redacted log is sent to Google AI Studio (Gemini API free tier). Google may use free-tier inputs to improve its products, so don't paste confidential logs. For private analysis, run Gemma locally with Ollama.",
        models,
        apiKey,
        jsonMode: bool(env.GOOGLE_JSON_MODE),
        supportsSystemRole: true,
        maxTokensParam: "max_tokens",
        thinkingLevel: env.GOOGLE_THINKING_LEVEL?.trim().toUpperCase() || undefined,
      };
    },
  },
  {
    id: "ollama",
    resolve(env) {
      const baseURL = env.OLLAMA_BASE_URL?.trim();
      const models = csv(env.OLLAMA_MODELS);
      if (!baseURL || models.length === 0) return null;
      return {
        id: "ollama",
        label: "Ollama (local)",
        kind: "openai-compatible",
        hosting: isLocalUrl(baseURL) ? "local" : "hosted",
        dataNotice: "Runs through Ollama on the machine that hosts CrashCart. With a local Ollama, your log never leaves that machine.",
        models: models.map((id) => ({ id, label: id, openWeight: true, license: licenseFor(id) })),
        baseURL,
        apiKey: "ollama",
        jsonMode: bool(env.OLLAMA_JSON_MODE),
        supportsSystemRole: true,
        maxTokensParam: "max_tokens",
      };
    },
  },
  {
    id: "xai",
    resolve(env) {
      const apiKey = env.XAI_API_KEY?.trim();
      const models = csv(env.XAI_MODELS);
      if (!apiKey || models.length === 0) return null;
      return {
        id: "xai",
        label: "xAI",
        kind: "openai-compatible",
        hosting: "hosted",
        dataNotice: "Your redacted log is sent to xAI.",
        models: models.map((id) => ({ id, label: id, openWeight: false })),
        apiKey,
        baseURL: env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1",
        jsonMode: bool(env.XAI_JSON_MODE),
        supportsSystemRole: true,
        maxTokensParam: "max_tokens",
      };
    },
  },
  {
    id: "custom",
    resolve(env) {
      const baseURL = env.CUSTOM_OPENAI_BASE_URL?.trim();
      const models = csv(env.CUSTOM_OPENAI_MODELS);
      if (!baseURL || models.length === 0) return null;
      const label = env.CUSTOM_OPENAI_LABEL?.trim() || "Custom provider";
      const openWeight = bool(env.CUSTOM_OPENAI_OPEN_WEIGHT);
      return {
        id: "custom",
        label,
        kind: "openai-compatible",
        hosting: isLocalUrl(baseURL) ? "local" : "hosted",
        dataNotice: `Your redacted log is sent to ${label}.`,
        models: models.map((id) => ({ id, label: id, openWeight, license: openWeight ? licenseFor(id) : undefined })),
        apiKey: env.CUSTOM_OPENAI_API_KEY?.trim() || undefined,
        baseURL,
        jsonMode: bool(env.CUSTOM_OPENAI_JSON_MODE),
        supportsSystemRole: true,
        maxTokensParam: "max_tokens",
      };
    },
  },
];

export function resolveProviders(env: Env = process.env): ResolvedProvider[] {
  return PROVIDERS.map((p) => p.resolve(env)).filter((p): p is ResolvedProvider => p !== null);
}

export function findSelection(
  providers: ResolvedProvider[],
  providerId: string,
  modelId: string,
): { provider: ResolvedProvider; model: ModelInfo } | null {
  const provider = providers.find((p) => p.id === providerId);
  const model = provider?.models.find((m) => m.id === modelId);
  return provider && model ? { provider, model } : null;
}

/** Configured default if valid; otherwise the first open-weight model; otherwise the first model. */
export function defaultSelection(
  providers: ResolvedProvider[],
  config: Pick<AppConfig, "defaultProvider" | "defaultModel">,
): { providerId: string; modelId: string } | null {
  if (config.defaultProvider && config.defaultModel && findSelection(providers, config.defaultProvider, config.defaultModel)) {
    return { providerId: config.defaultProvider, modelId: config.defaultModel };
  }
  for (const p of providers) {
    const open = p.models.find((m) => m.openWeight);
    if (open) return { providerId: p.id, modelId: open.id };
  }
  const first = providers[0];
  return first ? { providerId: first.id, modelId: first.models[0].id } : null;
}

export function toPublicProviders(providers: ResolvedProvider[]): PublicProvider[] {
  return providers.map((p) => ({
    id: p.id,
    label: p.label,
    hosting: p.hosting,
    dataNotice: p.dataNotice,
    models: p.models.map(({ id, label, openWeight, license }) => ({ id, label, openWeight, license })),
  }));
}
