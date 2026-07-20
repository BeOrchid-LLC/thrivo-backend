import { closeDb } from "./index";
import { logger } from "../src/lib/logger";
import { env } from "../src/env";
import { adminAccountRepo } from "../src/repositories";
import { hashPassword } from "../src/admin/password";
import type { AdminRole } from "../src/admin/otp.service";

/**
 * Admin seed — idempotent. Two responsibilities:
 *
 * 1. Guarantee `subscriptions@beorchid.com` exists as the super admin, with the
 *    initial password taken from SUPER_ADMIN_INITIAL_PASSWORD (never committed).
 *    Skipped with a warning if the env var isn't set.
 *
 * 2. Bootstrap-migrate any env-allowlisted admins (ADMIN_EMAILS + ADMIN_ROLES,
 *    the pre-DB source of admin identity) into `admin_users` as `active` with
 *    no password — they keep working via the OTP fallback until they set one
 *    through the forgot-password flow.
 */

const SUPER_ADMIN_EMAIL = "subscriptions@beorchid.com";

function envRoleFor(email: string): AdminRole {
  const lower = email.toLowerCase();
  return (env.ADMIN_ROLES[lower] ?? "admin") as AdminRole;
}

async function seedSuperAdmin(): Promise<void> {
  if (!env.SUPER_ADMIN_INITIAL_PASSWORD) {
    logger.warn(
      "SUPER_ADMIN_INITIAL_PASSWORD is not set — skipping super-admin seed. Set it in the deploy env to (re)seed subscriptions@beorchid.com."
    );
    return;
  }
  const passwordHash = await hashPassword(env.SUPER_ADMIN_INITIAL_PASSWORD);
  await adminAccountRepo.upsertActive({
    email: SUPER_ADMIN_EMAIL,
    name: "Super Admin",
    role: "super-admin",
    passwordHash,
  });
  logger.info({ email: SUPER_ADMIN_EMAIL }, "super admin seeded");
}

async function migrateEnvAllowlist(): Promise<void> {
  const emails = new Set<string>([...env.ADMIN_EMAILS, ...Object.keys(env.ADMIN_ROLES)]);
  emails.delete(SUPER_ADMIN_EMAIL); // owned by seedSuperAdmin

  for (const email of emails) {
    await adminAccountRepo.upsertActiveNoPassword({
      email,
      name: null,
      role: envRoleFor(email),
    });
    logger.info({ email }, "env admin migrated into admin_users");
  }
}

async function seed(): Promise<void> {
  logger.info("seeding admin accounts…");
  await seedSuperAdmin();
  await migrateEnvAllowlist();
  logger.info("admin seed complete");
}

seed()
  .then(closeDb)
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "admin seed failed");
    process.exit(1);
  });
