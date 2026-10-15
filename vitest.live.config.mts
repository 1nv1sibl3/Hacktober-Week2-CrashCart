import path from "node:path";
import { defineConfig } from "vitest/config";

// Opt-in tests against the real model API. Run with: npm run test:live
// They spend free-tier quota, so they never run as part of `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    testTimeout: 150_000,
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
