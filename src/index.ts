import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import * as Sentry from "@sentry/node";

// Environment validation
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  SENTRY_DSN: z.string().url().optional(),
});

type Env = z.infer<typeof envSchema>;

let env: Env;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("Environment validation failed:");
    error.errors.forEach((err) => {
      console.error(`  ${err.path.join(".")}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

// Initialize Sentry
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}

// Create app
const app = new Hono();

// Middleware
app.use(logger());

// Routes
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/ready", (c) => {
  return c.json({
    status: "ready",
  });
});

// Error handling
app.onError((err, c) => {
  console.error(err);
  if (env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: env.NODE_ENV === "production" ? "Internal server error" : err.message,
      },
    },
    { status: 500 }
  );
});

// Start server
const port = env.PORT;
console.log(`[${new Date().toISOString()}] Starting server on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
