import { EXAMPLE_LOGS } from "@/lib/examples";
import type { AppConfig } from "@/server/env";
import type { ResolvedProvider } from "@/server/providers/catalog";

export const DOCKER_LOG = EXAMPLE_LOGS.find((e) => e.id === "docker-startup")!.log;

export const testConfig: AppConfig = {
  maxInputChars: 30_000,
  timeoutMs: 1_000,
  rateLimitPerMinute: 100,
  rateLimitPerDay: 1_000,
};

export const gemmaProvider: ResolvedProvider = {
  id: "google",
  label: "Google AI Studio",
  kind: "google",
  hosting: "hosted",
  dataNotice: "test notice",
  models: [{ id: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B", openWeight: true, license: "Apache-2.0" }],
  apiKey: "test-key",
  jsonMode: true,
  supportsSystemRole: true,
  maxTokensParam: "max_tokens",
  thinkingLevel: "MINIMAL",
};

export const proprietaryProvider: ResolvedProvider = {
  id: "xai",
  label: "xAI",
  kind: "openai-compatible",
  hosting: "hosted",
  dataNotice: "test notice",
  models: [{ id: "grok-test", label: "grok-test", openWeight: false }],
  apiKey: "test-key",
  baseURL: "https://example.invalid/v1",
  jsonMode: false,
  supportsSystemRole: true,
  maxTokensParam: "max_tokens",
};

/** A plausible, valid model reply for the Docker sample. Quotes exist verbatim in the (redacted) log. */
export function validModelOutput(overrides: Record<string, unknown> = {}) {
  return {
    summary: "The api container exits because it connects to Postgres on localhost instead of the db service.",
    category: "container",
    ecosystem: "docker",
    severity: "blocking",
    rootCause: {
      statement: "DATABASE_URL points at localhost, which inside the api container is the container itself.",
      explanation: "The connection to 127.0.0.1:5432 is refused while the db container reports it is ready.",
      evidenceRefs: ["E1", "E2"],
    },
    confidence: { level: "high", rationale: "The refused connection and the ready database are both in the log." },
    evidence: [
      { id: "E1", line: 33, quote: "api-1  | Error: connect ECONNREFUSED 127.0.0.1:5432", significance: "The API cannot reach Postgres." },
      { id: "E2", line: 46, quote: "database system is ready to accept connections", significance: "Postgres itself is up." },
    ],
    fix: {
      summary: "Use the compose service name as the database host.",
      steps: [
        {
          title: "Point DATABASE_URL at the db service",
          detail: "Replace localhost with db in docker-compose.yml.",
          snippet: { language: "yaml", content: "DATABASE_URL: postgres://app:${DB_PASSWORD}@db:5432/shop" },
        },
      ],
    },
    verification: [
      { step: "Restart and check the API logs", command: "docker compose up -d && docker compose logs api", expected: "No ECONNREFUSED" },
    ],
    alternatives: [],
    unknowns: [],
    warnings: [],
    issueTitle: "api exits with ECONNREFUSED because DATABASE_URL uses localhost",
    ...overrides,
  };
}

// Fake credentials are assembled at runtime so the repository never contains secret-shaped strings.
export const fake = {
  google: () => "AI" + "za" + "Sy" + "x".repeat(33),
  openai: () => "sk-" + "proj-" + "a".repeat(32),
  anthropic: () => "sk-" + "ant-" + "api03-" + "b".repeat(32),
  github: () => "gh" + "p_" + "c".repeat(36),
  aws: () => "AK" + "IA" + "IOSFODNN7EXAMPLE",
  stripe: () => "sk" + "_live_" + "d".repeat(24),
  npm: () => "np" + "m_" + "e".repeat(36),
  jwt: () => "ey" + "JhbGciOiJIUzI1NiJ9." + "ey" + "JzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
};
