import { z } from "zod";

// Single source of truth for what the model must return (ModelOutput), what the
// API returns (Diagnosis), and the shared request/error shapes. Isomorphic: no
// server-only imports here.

export const SCHEMA_VERSION = "1.0";

export const CATEGORIES = [
  "dependency",
  "import_module",
  "build_compile",
  "runtime_exception",
  "configuration",
  "network",
  "container",
  "permission",
  "resource",
  "syntax",
  "other",
] as const;

export const ECOSYSTEMS = [
  "node",
  "python",
  "docker",
  "java",
  "go",
  "rust",
  "dotnet",
  "ruby",
  "php",
  "other",
  "unknown",
] as const;

export const SEVERITIES = ["blocking", "degraded", "minor", "unknown"] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Ecosystem = (typeof ECOSYSTEMS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

// ---------- lenient field helpers ----------

function clip(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Required non-empty string, trimmed and clipped to `max` chars. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((s) => clip(s, max));

/** Optional string: empty / missing / null become undefined. */
const optText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => {
      const t = s?.trim();
      return t ? clip(t, max) : undefined;
    });

/** Enum that tolerates case, spaces, hyphens, and a missing key ("Import-Module" → "import_module"). */
function looseEnum<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  // Zod 4 rejects a missing key even for z.unknown(), so every lenient field is explicitly optional.
  return z
    .unknown()
    .optional()
    .transform((v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : ""))
    .transform((v): T[number] => ((values as readonly string[]).includes(v) ? (v as T[number]) : fallback));
}

/** Optional list: drops invalid items instead of failing the whole response, then caps length. */
function lenientList<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(z.unknown())
    .nullish()
    .transform((arr) =>
      (arr ?? [])
        .map((x) => item.safeParse(x))
        .filter((r) => r.success)
        .map((r) => r.data as z.output<T>)
        .slice(0, max),
    );
}

const lineNumber = z
  .unknown()
  .optional()
  .transform((v) => {
    const n = typeof v === "string" ? Number.parseInt(v, 10) : v;
    return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
  });

// ---------- ModelOutput: what the model must return ----------

const EvidenceItem = z.object({
  id: optText(12),
  line: lineNumber,
  quote: text(400),
  significance: optText(400),
});

/** A malformed snippet is dropped rather than failing its whole fix step. */
const Snippet = z
  .unknown()
  .optional()
  .transform((v): { language: string; content: string } | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const { language, content } = v as { language?: unknown; content?: unknown };
  if (typeof content !== "string" || !content.trim()) return undefined;
  const lang = typeof language === "string" && language.trim() ? clip(language.trim(), 24) : "text";
  return { language: lang, content: clip(content.replace(/\s+$/, ""), 4000) };
});

const FixStep = z.object({
  title: text(160),
  detail: optText(1200),
  snippet: Snippet,
});

const VerificationStep = z.object({
  step: text(300),
  command: optText(600),
  expected: optText(400),
});

const Alternative = z.object({
  hypothesis: text(300),
  whyLessLikely: optText(400),
  howToCheck: optText(400),
});

export const ModelOutputSchema = z.object({
  summary: text(500),
  category: looseEnum(CATEGORIES, "other"),
  ecosystem: looseEnum(ECOSYSTEMS, "unknown"),
  severity: looseEnum(SEVERITIES, "unknown"),
  rootCause: z.object({
    statement: text(500),
    explanation: optText(1500),
    evidenceRefs: lenientList(z.string().trim().min(1), 8),
  }),
  confidence: z.object({
    level: looseEnum(CONFIDENCE_LEVELS, "low"),
    rationale: text(600),
  }),
  evidence: lenientList(EvidenceItem, 8).refine((a) => a.length > 0, "at least one evidence quote is required"),
  fix: z.object({
    summary: text(500),
    steps: lenientList(FixStep, 6).refine((a) => a.length > 0, "at least one fix step with a title is required"),
  }),
  verification: lenientList(VerificationStep, 5),
  alternatives: lenientList(Alternative, 3),
  unknowns: lenientList(text(300), 5),
  warnings: lenientList(text(400), 5),
  issueTitle: optText(120),
});

export type ModelOutput = z.output<typeof ModelOutputSchema>;

// ---------- Diagnosis: the normalized API response ----------

export interface EvidenceView {
  id: string;
  quote: string;
  significance?: string;
  /** 1-based line range in `input.analyzedText`; null when the quote could not be found. */
  lineStart: number | null;
  lineEnd: number | null;
  verified: boolean;
  /** Why an unverified quote couldn't be confirmed. */
  unverifiedReason?: "not_found" | "too_short";
}

export interface WarningView {
  source: "model" | "crashcart";
  message: string;
}

export interface RedactionCount {
  type: string;
  count: number;
}

export interface Provenance {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  openWeight: boolean;
  license?: string;
  hosting: "hosted" | "local";
  durationMs: number;
  attempts: number;
  jsonMode: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface Diagnosis {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  createdAt: string;
  summary: string;
  category: Category;
  ecosystem: Ecosystem;
  severity: Severity;
  rootCause: { statement: string; explanation?: string; evidenceIds: string[] };
  confidence: {
    level: ConfidenceLevel;
    rationale: string;
    modelReportedLevel: ConfidenceLevel;
    adjustedReason?: string;
  };
  evidence: EvidenceView[];
  fix: ModelOutput["fix"];
  verification: ModelOutput["verification"];
  alternatives: ModelOutput["alternatives"];
  unknowns: string[];
  warnings: WarningView[];
  githubIssue: { title: string; body: string };
  provenance: Provenance;
  input: { chars: number; lines: number; redactions: RedactionCount[]; analyzedText: string };
}

// ---------- API shapes ----------

export const AnalyzeRequestSchema = z.object({
  log: z.string(),
  providerId: z.string().trim().min(1).max(64),
  modelId: z.string().trim().min(1).max(128),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const ERROR_CODES = [
  "INPUT_EMPTY",
  "INPUT_TOO_SHORT",
  "INPUT_TOO_LARGE",
  "INPUT_BINARY",
  "BAD_REQUEST",
  "FORBIDDEN_ORIGIN",
  "NOT_CONFIGURED",
  "RATE_LIMITED",
  "QUOTA_EXHAUSTED",
  "CONTENT_BLOCKED",
  "AUTH_FAILED",
  "UNAVAILABLE",
  "UNSUPPORTED_PARAM",
  "CONTEXT_TOO_LONG",
  "MODEL_OUTPUT_INVALID",
  "TIMEOUT",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retryAfterSeconds?: number;
    requestId: string;
  };
}

export interface PublicModel {
  id: string;
  label: string;
  openWeight: boolean;
  license?: string;
}

export interface PublicProvider {
  id: string;
  label: string;
  hosting: "hosted" | "local";
  dataNotice: string;
  models: PublicModel[];
}

export interface ProvidersResponse {
  providers: PublicProvider[];
  defaultSelection: { providerId: string; modelId: string } | null;
  limits: { maxInputChars: number };
}
