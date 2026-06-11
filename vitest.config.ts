import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Applies migrations once when RUN_DB_TESTS=1; no-op for unit-only runs.
    globalSetup: ["tests/helpers/global-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Gate the pure/business logic that unit tests own. Repositories + schema
      // are exercised by the (DB-gated) integration suite, not this threshold;
      // process bootstraps and live-connection singletons are excluded.
      include: [
        "src/lib/**",
        "src/middleware/**",
        "src/services/**",
        "src/integrations/**",
      ],
      exclude: [
        "src/lib/redis.ts", // live Redis connection — integration-only
        "src/lib/queue/connection.ts", // pure config from env, run on import
        "**/*.d.ts",
      ],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 75 },
    },
  },
});
