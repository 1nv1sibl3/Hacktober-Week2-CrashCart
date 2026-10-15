import "server-only";
import type { ApiErrorBody, ErrorCode } from "@/lib/schema/diagnosis";

interface ErrorDef {
  status: number;
  message: string;
  retryable: boolean;
}

// The only error text that reaches the browser. Raw provider messages are logged, never returned.
const DEFS: Record<ErrorCode, ErrorDef> = {
  INPUT_EMPTY: { status: 400, retryable: false, message: "Paste a log, stack trace, or build output to analyze." },
  INPUT_TOO_SHORT: { status: 400, retryable: false, message: "That's too short to diagnose. Paste the full error output." },
  INPUT_TOO_LARGE: { status: 400, retryable: false, message: "The log is over the size limit. Trim it to the part around the error." },
  INPUT_BINARY: { status: 400, retryable: false, message: "This looks like binary data, not a text log." },
  BAD_REQUEST: { status: 400, retryable: false, message: "The request was malformed." },
  FORBIDDEN_ORIGIN: { status: 403, retryable: false, message: "Requests must come from the CrashCart page." },
  NOT_CONFIGURED: {
    status: 400,
    retryable: false,
    message: "That provider or model isn't configured on this server. Pick another model.",
  },
  RATE_LIMITED: {
    status: 429,
    retryable: true,
    message: "Too many requests right now. Wait a moment and retry, or pick another model.",
  },
  QUOTA_EXHAUSTED: {
    status: 429,
    retryable: false,
    message: "The provider's daily quota for this model is used up. Try again later or pick another model.",
  },
  CONTENT_BLOCKED: {
    status: 422,
    retryable: false,
    message: "The provider declined to process this log (safety filter). Try removing unrelated content.",
  },
  AUTH_FAILED: {
    status: 502,
    retryable: false,
    message: "The provider rejected this server's credentials. The app operator needs to check the API key.",
  },
  UNAVAILABLE: {
    status: 502,
    retryable: true,
    message: "The model provider had a temporary error. Retry, or pick another model.",
  },
  UNSUPPORTED_PARAM: {
    status: 502,
    retryable: true,
    message: "The provider rejected a request option CrashCart uses. Retry, or pick another model.",
  },
  CONTEXT_TOO_LONG: { status: 400, retryable: false, message: "The log is too long for this model. Trim it and retry." },
  MODEL_OUTPUT_INVALID: {
    status: 502,
    retryable: true,
    message: "The model's answer didn't match the required format, even after a repair attempt. Retry — results vary between runs.",
  },
  TIMEOUT: { status: 504, retryable: true, message: "The model took too long to answer. Retry, or trim the log." },
  INTERNAL: { status: 500, retryable: true, message: "Something went wrong on our side. Please retry." },
};

export class CrashCartError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  /** Safe, user-facing override for the default message. Never put provider text here. */
  readonly publicMessage?: string;

  constructor(
    code: ErrorCode,
    detail?: string,
    opts: { retryable?: boolean; retryAfterSeconds?: number; publicMessage?: string } = {},
  ) {
    super(detail ?? code);
    this.name = "CrashCartError";
    this.code = code;
    this.retryable = opts.retryable ?? DEFS[code].retryable;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.publicMessage = opts.publicMessage;
  }
}

export function toErrorResponse(err: unknown, requestId: string): { status: number; body: ApiErrorBody } {
  const e = err instanceof CrashCartError ? err : new CrashCartError("INTERNAL", err instanceof Error ? err.message : String(err));
  const def = DEFS[e.code];
  return {
    status: def.status,
    body: {
      error: {
        code: e.code,
        message: e.publicMessage ?? def.message,
        retryable: e.retryable,
        ...(e.retryAfterSeconds !== undefined && { retryAfterSeconds: e.retryAfterSeconds }),
        requestId,
      },
    },
  };
}

/** Pull a retry hint like `"retryDelay": "37s"` or "retry in 12.5s" out of provider error text. */
export function parseRetryAfterSeconds(text: string): number | undefined {
  const m = text.match(/retry(?:Delay)?["']?\s*(?:[:=]|in)\s*["']?(\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.ceil(Number(m[1])) : undefined;
}
