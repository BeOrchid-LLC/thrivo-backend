import { describe, expect, it } from "vitest";
import { envSchema } from "../../src/env";

// Minimal always-required base; feature secrets are layered on per case.
const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "x".repeat(32),
  CLERK_SECRET_KEY: "sk_test_x",
  CLERK_PUBLISHABLE_KEY: "pk_test_x",
  CLERK_WEBHOOK_SECRET: "whsec_x",
  CLERK_ADMIN_SECRET_KEY: "sk_test_x",
  CLERK_ADMIN_PUBLISHABLE_KEY: "pk_test_x",
  CLERK_ADMIN_WEBHOOK_SECRET: "whsec_x",
};

describe("env policy", () => {
  it("accepts a minimal dev config without feature secrets", () => {
    expect(envSchema.safeParse({ ...base, NODE_ENV: "development" }).success).toBe(true);
  });

  it("normalizes configured push test recipient emails", () => {
    const result = envSchema.safeParse({
      ...base,
      NODE_ENV: "development",
      ADMIN_PUSH_TEST_USER_EMAILS: " QA@EXAMPLE.COM,qa@example.com, second@example.com ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ADMIN_PUSH_TEST_USER_EMAILS).toEqual([
        "qa@example.com",
        "second@example.com",
      ]);
    }
  });

  it("rejects invalid push test recipient emails", () => {
    const result = envSchema.safeParse({
      ...base,
      NODE_ENV: "development",
      ADMIN_PUSH_TEST_USER_EMAILS: "valid@example.com,not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("refuses production startup without the complete email security configuration", () => {
    const result = envSchema.safeParse({ ...base, NODE_ENV: "production" });
    expect(result.success).toBe(false);
    const keys = result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    expect(keys).toEqual(
      expect.arrayContaining([
        "RESEND_API_KEY",
        "RESEND_WEBHOOK_SECRET",
        "EMAIL_LINK_SECRET",
        "EMAIL_OUTBOX_ACTIVE_KEY_ID",
        "EMAIL_OUTBOX_ENCRYPTION_KEYS",
      ])
    );
  });

  it("accepts production when the complete email configuration is valid", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(
      envSchema.safeParse({
        ...base,
        NODE_ENV: "production",
        RESEND_API_KEY: "re_live_key",
        RESEND_WEBHOOK_SECRET: "whsec_resend",
        EMAIL_LINK_SECRET: "l".repeat(32),
        EMAIL_OUTBOX_ACTIVE_KEY_ID: "primary",
        EMAIL_OUTBOX_ENCRYPTION_KEYS: JSON.stringify({ primary: key }),
        AUTH_BASE_URL: "https://api.thrivo.fit",
        PUBLIC_APP_URL: "https://thrivo.fit",
        ADMIN_APP_URL: "https://admin.thrivo.fit",
      }).success
    ).toBe(true);
  });

  it("still refuses to boot without a core infrastructure var", () => {
    const { DATABASE_URL: _omit, ...noDb } = base;
    const result = envSchema.safeParse({ ...noDb, NODE_ENV: "production" });
    expect(result.success).toBe(false);
    const keys = result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    expect(keys).toContain("DATABASE_URL");
  });

  it("refuses to boot with a half-configured R2 storage setup", () => {
    const result = envSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      R2_ACCOUNT_ID: "account-only",
    });
    expect(result.success).toBe(false);
  });

  it("requires RevenueCat catalog configuration in production RevenueCat mode", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const result = envSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      BILLING_PROVIDER: "revenuecat",
      REVENUECAT_SECRET_API_KEY: "rc_secret",
      REVENUECAT_WEBHOOK_AUTH: "rc_webhook",
      REVENUECAT_ENTITLEMENT_ID: "Thrivo Premium",
      REVENUECAT_PRODUCT_CATALOG: JSON.stringify({
        app_store: {
          monthly: "thrivo_premium_monthly",
          annual: "thrivo_premium_annual",
        },
        play_store: {
          monthly: "thrivo_premium_monthly",
          annual: "thrivo_premium_annual",
        },
      }),
      RESEND_API_KEY: "re_live_key",
      RESEND_WEBHOOK_SECRET: "whsec_resend",
      EMAIL_LINK_SECRET: "l".repeat(32),
      EMAIL_OUTBOX_ACTIVE_KEY_ID: "primary",
      EMAIL_OUTBOX_ENCRYPTION_KEYS: JSON.stringify({ primary: key }),
      AUTH_BASE_URL: "https://api.thrivo.fit",
      PUBLIC_APP_URL: "https://thrivo.fit",
      ADMIN_APP_URL: "https://admin.thrivo.fit",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a complete Test Store catalog only when explicitly enabled", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const result = envSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      BILLING_PROVIDER: "revenuecat",
      REVENUECAT_ALLOW_TEST_STORE: "true",
      REVENUECAT_SECRET_API_KEY: "rc_secret",
      REVENUECAT_WEBHOOK_AUTH: "rc_webhook",
      REVENUECAT_ENTITLEMENT_ID: "Thrivo Premium",
      REVENUECAT_PRODUCT_CATALOG: JSON.stringify({
        app_store: { monthly: "app_monthly", annual: "app_annual" },
        play_store: { monthly: "play_monthly", annual: "play_annual" },
        test_store: { monthly: "test_monthly", annual: "test_annual" },
      }),
      RESEND_API_KEY: "re_live_key",
      RESEND_WEBHOOK_SECRET: "whsec_resend",
      EMAIL_LINK_SECRET: "l".repeat(32),
      EMAIL_OUTBOX_ACTIVE_KEY_ID: "primary",
      EMAIL_OUTBOX_ENCRYPTION_KEYS: JSON.stringify({ primary: key }),
      AUTH_BASE_URL: "https://api.thrivo.fit",
      PUBLIC_APP_URL: "https://thrivo.fit",
      ADMIN_APP_URL: "https://admin.thrivo.fit",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.REVENUECAT_ALLOW_TEST_STORE).toBe(true);
  });

  it("rejects an enabled Test Store without monthly and annual products", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const result = envSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      BILLING_PROVIDER: "revenuecat",
      REVENUECAT_ALLOW_TEST_STORE: "true",
      REVENUECAT_SECRET_API_KEY: "rc_secret",
      REVENUECAT_WEBHOOK_AUTH: "rc_webhook",
      REVENUECAT_ENTITLEMENT_ID: "Thrivo Premium",
      REVENUECAT_PRODUCT_CATALOG: JSON.stringify({
        app_store: { monthly: "app_monthly", annual: "app_annual" },
        play_store: { monthly: "play_monthly", annual: "play_annual" },
      }),
      RESEND_API_KEY: "re_live_key",
      RESEND_WEBHOOK_SECRET: "whsec_resend",
      EMAIL_LINK_SECRET: "l".repeat(32),
      EMAIL_OUTBOX_ACTIVE_KEY_ID: "primary",
      EMAIL_OUTBOX_ENCRYPTION_KEYS: JSON.stringify({ primary: key }),
      AUTH_BASE_URL: "https://api.thrivo.fit",
      PUBLIC_APP_URL: "https://thrivo.fit",
      ADMIN_APP_URL: "https://admin.thrivo.fit",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
        "REVENUECAT_PRODUCT_CATALOG.test_store"
      );
    }
  });

  it("keeps Test Store products optional when the flag is false", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const result = envSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      BILLING_PROVIDER: "revenuecat",
      REVENUECAT_ALLOW_TEST_STORE: "false",
      REVENUECAT_SECRET_API_KEY: "rc_secret",
      REVENUECAT_WEBHOOK_AUTH: "rc_webhook",
      REVENUECAT_ENTITLEMENT_ID: "Thrivo Premium",
      REVENUECAT_PRODUCT_CATALOG: JSON.stringify({
        app_store: { monthly: "app_monthly", annual: "app_annual" },
        play_store: { monthly: "play_monthly", annual: "play_annual" },
      }),
      RESEND_API_KEY: "re_live_key",
      RESEND_WEBHOOK_SECRET: "whsec_resend",
      EMAIL_LINK_SECRET: "l".repeat(32),
      EMAIL_OUTBOX_ACTIVE_KEY_ID: "primary",
      EMAIL_OUTBOX_ENCRYPTION_KEYS: JSON.stringify({ primary: key }),
      AUTH_BASE_URL: "https://api.thrivo.fit",
      PUBLIC_APP_URL: "https://thrivo.fit",
      ADMIN_APP_URL: "https://admin.thrivo.fit",
    });
    expect(result.success).toBe(true);
  });
});
