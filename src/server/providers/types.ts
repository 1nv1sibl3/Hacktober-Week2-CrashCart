import "server-only";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature: number;
  /** false → send only the minimal portable request (no JSON mode, no thinking config). */
  useOptionalParams: boolean;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  finishReason: "stop" | "length" | "blocked" | "other";
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * One analysis call against one provider/model. Adapters translate every failure
 * into a CrashCartError (see src/server/errors.ts) and never retry on their own.
 */
export interface ProviderAdapter {
  /** Whether native JSON mode is used when `useOptionalParams` is true. */
  readonly jsonMode: boolean;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
