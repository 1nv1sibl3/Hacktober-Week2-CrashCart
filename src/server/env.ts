import "server-only";
import { DEFAULT_MAX_INPUT_CHARS } from "@/lib/input";

export type Env = Record<string, string | undefined>;

export function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function bool(value: string | undefined, fallback = false): boolean {
  const v = value?.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export interface AppConfig {
  defaultProvider?: string;
  defaultModel?: string;
  maxInputChars: number;
  timeoutMs: number;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
}

/** Read on every call so runtime env changes apply; callers in GET handlers must `await connection()` first. */
export function getConfig(env: Env = process.env): AppConfig {
  return {
    defaultProvider: env.CRASHCART_DEFAULT_PROVIDER?.trim() || undefined,
    defaultModel: env.CRASHCART_DEFAULT_MODEL?.trim() || undefined,
    maxInputChars: int(env.CRASHCART_MAX_INPUT_CHARS, DEFAULT_MAX_INPUT_CHARS, 1_000, 200_000),
    timeoutMs: int(env.CRASHCART_PROVIDER_TIMEOUT_MS, 45_000, 5_000, 110_000),
    rateLimitPerMinute: int(env.CRASHCART_RATE_LIMIT_PER_MINUTE, 5, 1, 1_000),
    rateLimitPerDay: int(env.CRASHCART_RATE_LIMIT_PER_DAY, 40, 1, 100_000),
  };
}
