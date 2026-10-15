import "server-only";
import type { ModelInfo, ResolvedProvider } from "./catalog";
import { createGoogleAdapter } from "./google";
import { createOpenAICompatibleAdapter } from "./openai-compatible";
import type { ProviderAdapter } from "./types";

export type AdapterFactory = (provider: ResolvedProvider, model: ModelInfo, timeoutMs: number) => ProviderAdapter;

export const createAdapter: AdapterFactory = (provider, model, timeoutMs) => {
  switch (provider.kind) {
    case "google":
      return createGoogleAdapter({
        apiKey: provider.apiKey ?? "",
        model: model.id,
        timeoutMs,
        jsonMode: provider.jsonMode,
        thinkingLevel: provider.thinkingLevel,
      });
    case "openai-compatible":
      return createOpenAICompatibleAdapter({
        baseURL: provider.baseURL ?? "",
        apiKey: provider.apiKey,
        model: model.id,
        timeoutMs,
        jsonMode: provider.jsonMode,
        supportsSystemRole: provider.supportsSystemRole,
        maxTokensParam: provider.maxTokensParam,
      });
  }
};
