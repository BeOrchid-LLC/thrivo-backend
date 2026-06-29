import { describe, expect, it } from "vitest";
import { envSchema } from "../../src/env";

// Minimal always-required base; feature secrets are layered on per case.
const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "x".repeat(32),
};

const prodSecrets = {
  RESEND_API_KEY: "re_test",
  ANTHROPIC_API_KEY: "sk-ant-test",
  REVENUECAT_WEBHOOK_AUTH: "whsec_test",
  SENTRY_DSN: "https://abc@o1.ingest.sentry.io/1",
};

function keysOf(result: ReturnType<typeof envSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("env fail-fast", () => {
  it("accepts a minimal dev config without feature secrets", () => {
    expect(envSchema.safeParse({ ...base, NODE_ENV: "development" }).success).toBe(true);
  });

  it("rejects production missing required feature secrets, naming each", () => {
    const result = envSchema.safeParse({ ...base, NODE_ENV: "production" });
    expect(result.success).toBe(false);
    expect(keysOf(result)).toEqual(
      expect.arrayContaining([
        "RESEND_API_KEY",
        "ANTHROPIC_API_KEY",
        "REVENUECAT_WEBHOOK_AUTH",
        "SENTRY_DSN",
      ])
    );
  });

  it("accepts production when all required feature secrets are present", () => {
    expect(envSchema.safeParse({ ...base, NODE_ENV: "production", ...prodSecrets }).success).toBe(
      true
    );
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
