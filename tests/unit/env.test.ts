import { describe, expect, it } from "vitest";
import { envSchema } from "../../src/env";

// Minimal always-required base; feature secrets are layered on per case.
const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "x".repeat(32),
};

function keysOf(result: ReturnType<typeof envSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("env policy", () => {
  it("accepts a minimal dev config without feature secrets", () => {
    expect(envSchema.safeParse({ ...base, NODE_ENV: "development" }).success).toBe(true);
  });

  it("boots in production without feature secrets (they fail at point-of-use, not boot)", () => {
    // Missing ANTHROPIC_API_KEY / REVENUECAT_WEBHOOK_AUTH / RESEND_API_KEY / SENTRY_DSN
    // must NOT crash startup — only the action that needs one fails, with a log.
    expect(envSchema.safeParse({ ...base, NODE_ENV: "production" }).success).toBe(true);
  });

  it("still refuses to boot without a core infrastructure var", () => {
    const { DATABASE_URL: _omit, ...noDb } = base;
    const result = envSchema.safeParse({ ...noDb, NODE_ENV: "production" });
    expect(result.success).toBe(false);
    expect(keysOf(result)).toContain("DATABASE_URL");
  });

  it("rejects a half-configured OAuth provider in any environment", () => {
    const result = envSchema.safeParse({
      ...base,
      NODE_ENV: "development",
      GOOGLE_CLIENT_ID: "id-only",
    });
    expect(result.success).toBe(false);
    expect(keysOf(result)).toContain("GOOGLE_CLIENT_SECRET");
  });

  it("accepts a fully-configured OAuth provider", () => {
    expect(
      envSchema.safeParse({
        ...base,
        NODE_ENV: "development",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }).success
    ).toBe(true);
  });
});
