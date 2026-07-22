/**
 * One-time migration: link existing domain users to BeOrchid Consumer Clerk app user IDs.
 *
 * Targets users whose `auth_subject_id` is null or does not match the Clerk `user_xxx`
 * format (i.e. pre-dates the Clerk migration — hand-rolled magic-link or Google OAuth IDs).
 *
 * Resolution per user:
 *   1. Look up a Clerk user by email in the Consumer Clerk app.
 *   2. If found: update `auth_subject_id` to the Clerk `user_xxx` ID.
 *   3. If not found: skip — the user has not yet signed in via Clerk and will be
 *      linked on first sign-in via `resolveUser()` in identity.service.ts.
 *
 * Dry-run by default. Nothing is written unless --apply is passed.
 * Safe to re-run: already-linked rows (auth_subject_id LIKE 'user_%') are skipped.
 *
 * Requirements:
 *   CLERK_SECRET_KEY must be the Consumer Clerk app secret key.
 *   CLERK_ADMIN_SECRET_KEY / CLERK_ADMIN_PUBLISHABLE_KEY / CLERK_ADMIN_WEBHOOK_SECRET
 *   are also required by env.ts — set real or placeholder values if running locally
 *   without the Admin Clerk app configured yet.
 *
 * Usage:
 *   npx tsx scripts/migrate-users-to-clerk.ts            # dry-run
 *   npx tsx scripts/migrate-users-to-clerk.ts --apply    # write changes
 */
import { createClerkClient } from "@clerk/backend";
import { eq, isNull, like, not, or } from "drizzle-orm";
import { closeDb, db } from "../db";
import { users } from "../db/schema";
import { env } from "../src/env";
import { logger } from "../src/lib/logger";

const apply = process.argv.includes("--apply");

async function main() {
  logger.info({ apply }, "migrate-users-to-clerk: starting");

  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

  // Find users with no Clerk ID yet (null or non-user_xxx format).
  const rows = await db
    .select({ id: users.id, email: users.email, authSubjectId: users.authSubjectId })
    .from(users)
    .where(
      or(
        isNull(users.authSubjectId),
        not(like(users.authSubjectId, "user_%"))
      )
    )
    .orderBy(users.createdAt);

  logger.info({ total: rows.length }, "migrate-users-to-clerk: users to evaluate");

  let linked = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const { data: clerkUsers } = await clerk.users.getUserList({
        emailAddress: [row.email],
        limit: 1,
      });

      const clerkUser = clerkUsers[0];

      if (!clerkUser) {
        logger.debug(
          { userId: row.id, email: row.email },
          "migrate-users-to-clerk: no Clerk user found — skipping (will link on first sign-in)"
        );
        skipped++;
        continue;
      }

      if (apply) {
        await db
          .update(users)
          .set({ authSubjectId: clerkUser.id })
          .where(eq(users.id, row.id));
        logger.info(
          { userId: row.id, clerkUserId: clerkUser.id, email: row.email },
          "migrate-users-to-clerk: linked"
        );
      } else {
        logger.info(
          { userId: row.id, clerkUserId: clerkUser.id, email: row.email },
          "migrate-users-to-clerk: [dry-run] would link"
        );
      }

      linked++;
    } catch (err) {
      logger.error(
        { userId: row.id, email: row.email, err },
        "migrate-users-to-clerk: error processing user"
      );
      errors++;
    }
  }

  logger.info(
    { apply, linked, skipped, errors, total: rows.length },
    "migrate-users-to-clerk: done"
  );

  await closeDb();
}

main().catch((err) => {
  logger.error({ err }, "migrate-users-to-clerk: fatal error");
  process.exit(1);
});
