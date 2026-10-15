import { analyzeLog } from "@/server/analysis/analyze";
import { getConfig } from "@/server/env";
import { CrashCartError, toErrorResponse } from "@/server/errors";
import { checkRateLimit, clientKey } from "@/server/rate-limit";
import { AnalyzeRequestSchema } from "@/lib/schema/diagnosis";

// Two model calls at up to CRASHCART_PROVIDER_TIMEOUT_MS each must fit inside this.
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store" };

/** Browsers send Origin on cross-site POSTs; anything other than our own host (or no Origin, e.g. curl) is rejected. */
function isForeignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return !host || new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const config = getConfig();
  let providerId: string | undefined;
  let modelId: string | undefined;

  try {
    if (isForeignOrigin(request)) throw new CrashCartError("FORBIDDEN_ORIGIN");

    const limit = checkRateLimit(clientKey(request.headers), config.rateLimitPerMinute, config.rateLimitPerDay);
    if (!limit.ok) {
      throw new CrashCartError("RATE_LIMITED", "crashcart per-IP limit", {
        retryAfterSeconds: limit.retryAfterSeconds,
        publicMessage: "You've hit this demo's request limit. Wait a bit and retry.",
      });
    }

    // Bound the body before parsing it.
    const maxBodyChars = config.maxInputChars * 2 + 4096;
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > maxBodyChars * 4) throw new CrashCartError("INPUT_TOO_LARGE");
    const raw = await request.text();
    if (raw.length > maxBodyChars) throw new CrashCartError("INPUT_TOO_LARGE");

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new CrashCartError("BAD_REQUEST", "invalid JSON body");
    }
    const body = AnalyzeRequestSchema.safeParse(json);
    if (!body.success) throw new CrashCartError("BAD_REQUEST", "body failed schema validation");
    ({ providerId, modelId } = body.data);

    const diagnosis = await analyzeLog({ ...body.data, signal: request.signal });

    // Metadata only — never log the log.
    console.info(
      JSON.stringify({
        evt: "analyze.ok",
        requestId,
        providerId,
        modelId,
        durationMs: Date.now() - started,
        attempts: diagnosis.provenance.attempts,
        inputChars: diagnosis.input.chars,
        redactions: diagnosis.input.redactions,
        usage: diagnosis.provenance.usage,
        verifiedEvidence: diagnosis.evidence.filter((e) => e.verified).length,
        totalEvidence: diagnosis.evidence.length,
      }),
    );
    return Response.json({ diagnosis }, { headers: NO_STORE });
  } catch (err) {
    const { status, body } = toErrorResponse(err, requestId);
    console.warn(
      JSON.stringify({
        evt: "analyze.error",
        requestId,
        providerId,
        modelId,
        code: body.error.code,
        status,
        durationMs: Date.now() - started,
        detail: err instanceof Error ? err.message.slice(0, 300) : undefined,
      }),
    );
    const headers: Record<string, string> = { ...NO_STORE };
    if (body.error.retryAfterSeconds) headers["Retry-After"] = String(body.error.retryAfterSeconds);
    return Response.json(body, { status, headers });
  }
}
