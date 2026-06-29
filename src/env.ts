import { config } from "dotenv";
import { z } from "zod";

// Load .env before reading process.env. Idempotent: safe to import from the
// server runtime AND from drizzle.config.ts (which runs under drizzle-kit, in a
// separate process). This module imports only zod + dotenv so it never pulls in
// db/, Sentry, or the Hono app — keeping it cycle-free and cheap to import.
config();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    // CORS allowlist (comma-separated first-party origins). Native mobile sends no
    // Origin, so this governs the web + admin browsers. Dev default covers both.
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000,http://localhost:3001")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      ),

    // Data + infrastructure (required — the server refuses to boot without them).
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    // Signs access JWTs (HS256); required, min 32 chars. Falls back to the legacy
    // BETTER_AUTH_SECRET name so existing deploys keep booting without an env change.
    AUTH_SECRET: z.preprocess((v) => v ?? process.env.BETTER_AUTH_SECRET, z.string().min(32)),
    // Hand-rolled auth token lifetimes. Access is short (stateless, signature is
    // authority); refresh is DB-backed + rotating, so it can live longer safely.
    ACCESS_TOKEN_TTL: z.string().default("15m"),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // Deep link the OAuth callback redirects to with the issued tokens (the app
    // parses ?token/?refresh/?error). Fixed scheme — never built from user input,
    // so the callback can't be turned into an open redirect.
    APP_AUTH_REDIRECT_URL: z.string().default("thrivo://auth"),
    // Public base URL of the API. The Google OAuth redirect URI is derived from
    // this (<AUTH_BASE_URL>/api/v1/auth/google/callback) and the magic-link
    // fallback URL. Dev default.
    AUTH_BASE_URL: z.string().url().default("http://localhost:4000"),

    // OAuth provider credentials (optional — a provider is configured only when its
    // full set is present, so dev/CI boot without them). External lead time per
    // ADR-0017 (Google client; Apple Service ID + key).
    GOOGLE_CLIENT_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    GOOGLE_CLIENT_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    APPLE_CLIENT_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    APPLE_CLIENT_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

    // Observability (optional). Empty string in .env is treated as unset.
    SENTRY_DSN: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
    // Deployed build identifier (git SHA), injected at build/deploy. Tags Sentry
    // releases and is surfaced by /health. Absent in local dev → reported as "dev".
    GIT_SHA: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

    // AI "describe it" food estimate (Claude). Optional here; the estimate endpoint
    // fails fast without ANTHROPIC_API_KEY rather than guessing. Haiku is the
    // cost/latency fit for a per-log structured extraction; override per env.
    // Becomes required-in-prod in the env fail-fast sweep (Phase 8).
    ANTHROPIC_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),

    // Transactional email (Resend). Optional this phase — the email infra is
    // scaffolded in A1-8 but sends go live in A2/A5, where RESEND_API_KEY becomes
    // required. Without a key the send path degrades (logs + marks email_logs).
    RESEND_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    EMAIL_FROM: z.string().min(1).default("Thrivo <noreply@thrivo.fit>"),

    // Admin panel auth. ADMIN_EMAILS is a comma-separated allowlist of staff email
    // addresses permitted to sign in to the admin panel via OTP. Empty = no one can
    // sign in, which is a safe default for environments without admin staff.
    ADMIN_EMAILS: z
      .string()
      .default("")
      .transform((s) =>
        s
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      ),
    // httpOnly cookie TTL for admin sessions. Short but comfortable for a staff
    // session; re-login is low-friction. Expressed as a `jose` duration string.
    ADMIN_SESSION_TTL: z.string().default("8h"),

    // RevenueCat webhook shared secret (the exact Authorization header value set in
    // the RevenueCat dashboard). The webhook is the entitlement source of truth;
    // without this secret every inbound webhook is rejected (fail closed). Becomes
    // required-in-prod in the env fail-fast sweep (Phase 8).
    REVENUECAT_WEBHOOK_AUTH: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

    // Expo push access token. Optional — Expo push sends work without it; a token
    // raises rate limits and enables enhanced push security. The daily nudge
    // degrades to tokenless sends when absent.
    EXPO_ACCESS_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  })
  /**
   * Fail-fast hardening. Feature vars stay optional in dev/test so local + CI
   * boot without secrets, but production refuses to start when a live feature is
   * unconfigured — a missing key screams here, never silently no-ops at 3 AM.
   */
  .superRefine((parsed, ctx) => {
    if (parsed.NODE_ENV === "production") {
      const requiredInProd: Record<string, unknown> = {
        RESEND_API_KEY: parsed.RESEND_API_KEY, // OTP + transactional email delivery
        ANTHROPIC_API_KEY: parsed.ANTHROPIC_API_KEY, // AI "describe it" estimate
        REVENUECAT_WEBHOOK_AUTH: parsed.REVENUECAT_WEBHOOK_AUTH, // entitlement source of truth
        SENTRY_DSN: parsed.SENTRY_DSN, // crash/error visibility
      };
      for (const [key, value] of Object.entries(requiredInProd)) {
        if (!value) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when NODE_ENV=production`,
          });
        }
      }
    }

    // OAuth credentials are all-or-nothing: a half-configured provider is a
    // misconfiguration that should fail loudly, not silently disable sign-in.
    const pairs: ReadonlyArray<readonly [string, unknown, string, unknown]> = [
      [
        "GOOGLE_CLIENT_ID",
        parsed.GOOGLE_CLIENT_ID,
        "GOOGLE_CLIENT_SECRET",
        parsed.GOOGLE_CLIENT_SECRET,
      ],
      [
        "APPLE_CLIENT_ID",
        parsed.APPLE_CLIENT_ID,
        "APPLE_CLIENT_SECRET",
        parsed.APPLE_CLIENT_SECRET,
      ],
    ];
    for (const [idKey, idVal, secretKey, secretVal] of pairs) {
      if (Boolean(idVal) !== Boolean(secretVal)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [idVal ? secretKey : idKey],
          message: `${idKey} and ${secretKey} must be set together`,
        });
      }
    }
  });

export type Env = Readonly<z.infer<typeof envSchema>>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Runs before the logger exists, so console is the only channel here.
    console.error("❌ Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

/** Validated, frozen, typed environment. Import this instead of reading process.env. */
export const env = loadEnv();
