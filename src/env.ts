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

    // Signs admin session JWTs (HS256, separate issuer/audience from user auth);
    // required, min 32 chars. User-facing auth is now Clerk-managed.
    AUTH_SECRET: z.string().min(32),
    // Public base URL of the API. Used for health/ready, admin invite links, etc.
    AUTH_BASE_URL: z.string().url().default("http://localhost:4000"),

    // Clerk — BeOrchid Consumer app (mobile + public web). All three required.
    CLERK_SECRET_KEY: z.string().min(1),
    CLERK_PUBLISHABLE_KEY: z.string().min(1),
    // Webhook signing secret minted in the Clerk dashboard (Svix HMAC). Required
    // so every inbound event is signature-verified (fail closed on missing).
    CLERK_WEBHOOK_SECRET: z.string().min(1),

    // Clerk — BeOrchid Admin app (all admin/dashboard surfaces across the ecosystem).
    // Separate Clerk application from the consumer app: email+password only,
    // allowlisted admin emails. All three required; server refuses to boot without them.
    CLERK_ADMIN_SECRET_KEY: z.string().min(1),
    CLERK_ADMIN_PUBLISHABLE_KEY: z.string().min(1),
    CLERK_ADMIN_WEBHOOK_SECRET: z.string().min(1),

    // Observability (optional). Empty string in .env is treated as unset.
    SENTRY_DSN: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
    // Deployed build identifier (git SHA), injected at build/deploy. Tags Sentry
    // releases and is surfaced by /health. Absent in local dev → reported as "dev".
    GIT_SHA: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

    // AI "describe it" food estimate (Claude). Optional; the estimate endpoint
    // fails at use without ANTHROPIC_API_KEY (clear error + operator log) rather
    // than guessing. Haiku is the cost/latency fit for a per-log structured
    // extraction; override per env.
    ANTHROPIC_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5"),
    AI_ESTIMATE_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24),
    // Premium cap. Free users get AI_ESTIMATE_RATE_LIMIT_MAX_FREE instead — this
    // is metered Anthropic spend, not a flat-cost feature, so the free tier gets
    // a materially tighter cap rather than the same allowance as premium.
    AI_ESTIMATE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    AI_ESTIMATE_RATE_LIMIT_MAX_FREE: z.coerce.number().int().positive().default(5),
    AI_ESTIMATE_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60),
    AI_ESTIMATE_MAX_TOKENS: z.coerce.number().int().positive().max(256).default(160),

    // Open Food Facts-backed text search. Results are transient and cached by
    // normalized query so repeated popular searches do not keep hitting upstream.
    FOOD_SEARCH_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24),
    FOOD_SEARCH_CACHE_MAX_KEYS: z.coerce.number().int().positive().default(750),
    FOOD_SEARCH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    FOOD_SEARCH_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60),
    BARCODE_LOOKUP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    BARCODE_LOOKUP_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60),

    // Transactional email (Resend). Optional — without a key the send path fails
    // at use: it logs that RESEND_API_KEY is missing and marks email_logs as
    // failed rather than crashing the request (see integrations/resend.ts).
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
    // Optional per-email RBAC overrides: a comma-separated `email:role` map where
    // role is one of admin | support | read-only. Any email listed in
    // ADMIN_EMAILS but not here defaults to `admin` (back-compat). An email may
    // appear only here (grants access at the mapped role without also being in
    // ADMIN_EMAILS). Invalid role or malformed entry refuses server boot.
    ADMIN_ROLES: z
      .string()
      .default("")
      .transform((s, ctx) => {
        const map: Record<string, "admin" | "support" | "read-only"> = {};
        for (const pair of s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)) {
          const [emailRaw, roleRaw] = pair.split(":").map((x) => x.trim());
          const email = emailRaw?.toLowerCase();
          const role = roleRaw?.toLowerCase();
          if (!email || !role) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `ADMIN_ROLES entry "${pair}" must be "email:role"`,
            });
            return z.NEVER;
          }
          if (role !== "admin" && role !== "support" && role !== "read-only") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `ADMIN_ROLES role "${roleRaw}" must be admin | support | read-only`,
            });
            return z.NEVER;
          }
          map[email] = role;
        }
        return map;
      }),
    // httpOnly cookie TTL for admin sessions. Short but comfortable for a staff
    // session; re-login is low-friction. Expressed as a `jose` duration string.
    ADMIN_SESSION_TTL: z.string().default("8h"),
    // Public base URL of the admin SPA — used to build invite + password-reset
    // links in emails. Never built from user input, so the link can't be turned
    // into an open redirect. Dev default matches the admin dev server.
    ADMIN_APP_URL: z.string().url().default("http://localhost:3000"),
    // One-time seed password for the super admin (subscriptions@beorchid.com).
    // Optional so non-seeded environments boot; when set, db/seed-admins.ts
    // upserts the super admin with this password (hashed). Set it in Coolify —
    // never commit the literal — and change it on first login.
    SUPER_ADMIN_INITIAL_PASSWORD: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(10).optional()
    ),

    // RevenueCat webhook shared secret (the exact Authorization header value set in
    // the RevenueCat dashboard). The webhook is the entitlement source of truth;
    // without this secret every inbound webhook is rejected (fail closed) and an
    // operator log flags the missing var (see billing-webhook.service.ts).
    REVENUECAT_WEBHOOK_AUTH: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

    // Expo push access token. Optional — Expo push sends work without it; a token
    // raises rate limits and enables enhanced push security. The daily nudge
    // degrades to tokenless sends when absent.
    EXPO_ACCESS_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

    // Cloudflare R2 object storage (S3-compatible). Optional — the four core vars
    // are all-or-nothing (see superRefine). Absent → uploads fail at point-of-use
    // with a clear operator log (see r2.service.ts), never at boot. Keys are minted
    // server-side and clients PUT directly to R2 via short-lived presigned URLs.
    R2_ACCOUNT_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    R2_ACCESS_KEY_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    R2_SECRET_ACCESS_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    R2_BUCKET_NAME: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
    // Root key prefix that namespaces every object (e.g. "staging-files"). Lets a
    // single bucket safely host multiple environments.
    R2_FOLDER_PREFIX: z.string().default("staging-files"),
    // Public read URLs. CDN_URL (custom domain) wins; PUBLIC_URL (e.g. *.r2.dev) is
    // the fallback. At least one is needed for the stored URL to be fetchable.
    R2_CDN_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
    R2_PUBLIC_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  })
  /**
   * Env policy: the server always boots as long as the core infrastructure vars
   * (DATABASE_URL, REDIS_URL, AUTH_SECRET) are present. Feature vars
   * (ANTHROPIC_API_KEY, REVENUECAT_WEBHOOK_AUTH, RESEND_API_KEY, SENTRY_DSN,
   * OAuth, Expo push) are intentionally optional even in production — a missing
   * one does NOT crash the process. Instead, the specific action that needs it
   * fails at point-of-use with an operator log naming the missing var and a clear
   * error returned to the caller (see anthropic/client.ts, billing-webhook.service.ts,
   * integrations/resend.ts). This keeps a partially-configured deploy running
   * rather than refusing to start over a feature that may not be exercised yet.
   */
  .superRefine((parsed, ctx) => {
    // R2 is all-or-nothing on its four core credentials: a half-configured bucket
    // is a misconfiguration that should fail loudly, not silently disable uploads.
    const r2Core: ReadonlyArray<readonly [string, unknown]> = [
      ["R2_ACCOUNT_ID", parsed.R2_ACCOUNT_ID],
      ["R2_ACCESS_KEY_ID", parsed.R2_ACCESS_KEY_ID],
      ["R2_SECRET_ACCESS_KEY", parsed.R2_SECRET_ACCESS_KEY],
      ["R2_BUCKET_NAME", parsed.R2_BUCKET_NAME],
    ];
    const r2Set = r2Core.filter(([, v]) => Boolean(v));
    if (r2Set.length > 0 && r2Set.length < r2Core.length) {
      for (const [key, val] of r2Core) {
        if (!val) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "All four R2_* credentials must be set together to enable object storage",
          });
        }
      }
    }
    // With R2 configured, at least one public URL is required for stored object URLs
    // to be fetchable by clients.
    if (r2Set.length === r2Core.length && !parsed.R2_CDN_URL && !parsed.R2_PUBLIC_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["R2_PUBLIC_URL"],
        message: "Set R2_CDN_URL or R2_PUBLIC_URL so uploaded objects have a public URL",
      });
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
