import { defineConfig } from "drizzle-kit";
import { env } from "./src/env";

// Migrations are generated (`drizzle-kit generate`) and applied (`drizzle-kit
// migrate`) — never hand-edited. The schema barrel is the single source of truth.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: { url: env.DATABASE_URL },
  strict: true,
  verbose: true,
});
