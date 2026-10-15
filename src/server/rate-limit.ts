import "server-only";

// Best-effort, in-memory, per-IP limits. On serverless hosts each instance keeps
// its own counters, so this slows abuse of the demo's free-tier key; it is not a
// hard guarantee. Documented as a known limitation.

interface Bucket {
  count: number;
  resetAt: number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_KEYS = 10_000;

const minuteBuckets = new Map<string, Bucket>();
const dayBuckets = new Map<string, Bucket>();

function current(map: Map<string, Bucket>, key: string, windowMs: number, now: number): Bucket {
  const existing = map.get(key);
  if (existing && existing.resetAt > now) return existing;
  if (map.size >= MAX_KEYS) {
    for (const [k, b] of map) if (b.resetAt <= now) map.delete(k);
  }
  const fresh = { count: 0, resetAt: now + windowMs };
  map.set(key, fresh);
  return fresh;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function checkRateLimit(key: string, perMinute: number, perDay: number, now = Date.now()): RateLimitResult {
  const minute = current(minuteBuckets, key, MINUTE, now);
  const day = current(dayBuckets, key, DAY, now);
  if (minute.count >= perMinute) return { ok: false, retryAfterSeconds: Math.ceil((minute.resetAt - now) / 1000) };
  if (day.count >= perDay) return { ok: false, retryAfterSeconds: Math.ceil((day.resetAt - now) / 1000) };
  minute.count += 1;
  day.count += 1;
  return { ok: true };
}

export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "local";
}

/** Test helper. */
export function resetRateLimits(): void {
  minuteBuckets.clear();
  dayBuckets.clear();
}
