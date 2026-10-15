import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analyze/route";
import { resetRateLimits } from "@/server/rate-limit";
import { defaultSelection, resolveProviders, toPublicProviders } from "@/server/providers/catalog";
import { DOCKER_LOG } from "../helpers";

// No provider credentials are set here, so these requests never reach a model.
const PROVIDER_ENV = [
  "GEMINI_API_KEY",
  "GOOGLE_GEMMA_MODELS",
  "GOOGLE_GEMINI_MODELS",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODELS",
  "XAI_API_KEY",
  "XAI_MODELS",
  "CUSTOM_OPENAI_BASE_URL",
  "CUSTOM_OPENAI_MODELS",
];

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost:3000/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", "x-forwarded-for": "203.0.113.7", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const validBody = { log: DOCKER_LOG, providerId: "google", modelId: "gemma-4-26b-a4b-it" };

describe("POST /api/analyze", () => {
  beforeEach(() => {
    for (const key of PROVIDER_ENV) vi.stubEnv(key, "");
    vi.stubEnv("CRASHCART_RATE_LIMIT_PER_MINUTE", "100");
    resetRateLimits();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects malformed JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("rejects a body that fails the schema", async () => {
    const res = await post({ log: 42 });
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("rejects cross-site requests", async () => {
    const res = await post(validBody, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("accepts same-origin requests and explains an unconfigured provider without leaking details", async () => {
    const res = await post(validBody, { origin: "http://localhost:3000" });
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { error } = await res.json();
    expect(error).toMatchObject({ code: "NOT_CONFIGURED", retryable: false });
    expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(error.message).not.toContain("unknown selection");
  });

  it("rejects oversized bodies before parsing", async () => {
    const res = await post({ ...validBody, log: "x".repeat(70_000) });
    expect((await res.json()).error.code).toBe("INPUT_TOO_LARGE");
  });

  it("rate-limits per client IP and sends Retry-After", async () => {
    vi.stubEnv("CRASHCART_RATE_LIMIT_PER_MINUTE", "2");
    await post(validBody);
    await post(validBody);
    const third = await post(validBody);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await third.json()).error.code).toBe("RATE_LIMITED");
    const otherClient = await post(validBody, { "x-forwarded-for": "198.51.100.9" });
    expect(otherClient.status).toBe(400);
  });

  it("never logs the submitted log", async () => {
    const info = vi.spyOn(console, "info");
    const warn = vi.spyOn(console, "warn");
    await post(validBody);
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain("docker compose up");
    expect(logged).not.toContain("SuperSecret123");
  });
});

describe("provider catalog", () => {
  it("lists nothing when no credentials are configured", () => {
    expect(resolveProviders({})).toEqual([]);
    expect(defaultSelection([], {})).toBeNull();
  });

  it("exposes Gemma as open-weight Apache-2.0 and extra Gemini models as proprietary", () => {
    const [google] = resolveProviders({ GEMINI_API_KEY: "k", GOOGLE_GEMMA_MODELS: "", GOOGLE_GEMINI_MODELS: "gemini-3.6-flash" });
    expect(google.models).toEqual([
      { id: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B", openWeight: true, license: "Apache-2.0" },
      { id: "gemini-3.6-flash", label: "gemini-3.6-flash", openWeight: false },
    ]);
  });

  it("detects local hosting and open weights for Ollama", () => {
    const [ollama] = resolveProviders({ OLLAMA_BASE_URL: "http://localhost:11434/v1", OLLAMA_MODELS: "gemma4:e4b" });
    expect(ollama).toMatchObject({ id: "ollama", hosting: "local", kind: "openai-compatible" });
    expect(ollama.models[0]).toMatchObject({ openWeight: true, license: "Apache-2.0" });
  });

  it("defaults to the configured model, else the first open-weight model", () => {
    const providers = resolveProviders({ GEMINI_API_KEY: "k", XAI_API_KEY: "x", XAI_MODELS: "grok-test" });
    expect(defaultSelection(providers, { defaultProvider: "xai", defaultModel: "grok-test" })).toEqual({ providerId: "xai", modelId: "grok-test" });
    expect(defaultSelection(providers, { defaultProvider: "google", defaultModel: "gone" })).toEqual({
      providerId: "google",
      modelId: "gemma-4-26b-a4b-it",
    });
  });

  it("never exposes keys or base URLs in the public provider list", () => {
    const providers = resolveProviders({
      GEMINI_API_KEY: "secret-google-key",
      CUSTOM_OPENAI_BASE_URL: "https://private.example.invalid/v1",
      CUSTOM_OPENAI_API_KEY: "secret-custom-key",
      CUSTOM_OPENAI_MODELS: "m1",
    });
    const json = JSON.stringify(toPublicProviders(providers));
    expect(json).not.toContain("secret-google-key");
    expect(json).not.toContain("secret-custom-key");
    expect(json).not.toContain("private.example.invalid");
  });
});
