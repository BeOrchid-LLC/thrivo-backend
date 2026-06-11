import { config } from "dotenv";
import { z } from "zod";

// Load .env before reading process.env. Idempotent: safe to import from the
// server runtime AND from drizzle.config.ts (which runs under drizzle-kit, in a
// separate process). This module imports only zod + dotenv so it never pulls in
// db/, Sentry, or the Hono app — keeping it cycle-free and cheap to import.
config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

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

  // Auth/session secret (BetterAuth lands in A1-4; renamed there if needed).
  JWT_SECRET: z.string().min(32),

  // Observability (optional). Empty string in .env is treated as unset.
  SENTRY_DSN: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  // Deployed build identifier (git SHA), injected at build/deploy. Tags Sentry
  // releases and is surfaced by /health. Absent in local dev → reported as "dev".
  GIT_SHA: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

  // Transactional email (Resend). Optional this phase — the email infra is
  // scaffolded in A1-8 but sends go live in A2/A5, where RESEND_API_KEY becomes
  // required. Without a key the send path degrades (logs + marks email_logs).
  RESEND_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  EMAIL_FROM: z.string().min(1).default("Thrivo <noreply@thrivo.fit>"),

  // Later-phase secrets become *required* in their own phase by extending this
  // schema, following the same fail-fast pattern, e.g.:
  //   REVENUECAT_WEBHOOK_SECRET: z.string(),      // A5  — subscription webhooks
  //   STRIPE_SECRET_KEY: z.string(),              // A5  — billing fallback
  //   EXPO_ACCESS_TOKEN: z.string(),              // A2  — push delivery
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
