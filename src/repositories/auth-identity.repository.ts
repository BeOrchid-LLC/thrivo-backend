import { eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { auth_user } from "../../db/schema";
import { newId } from "../lib/ids";

export type AuthUserRow = typeof auth_user.$inferSelect;

export async function findById(id: string, tx: Executor = db): Promise<AuthUserRow | null> {
  const [row] = await tx.select().from(auth_user).where(eq(auth_user.id, id)).limit(1);
  return row ?? null;
}

export async function findByEmail(email: string, tx: Executor = db): Promise<AuthUserRow | null> {
  const [row] = await tx
    .select()
    .from(auth_user)
    .where(eq(auth_user.email, email.toLowerCase()))
    .limit(1);
  return row ?? null;
}

/**
 * The auth identity for an email, creating it if absent. `auth_user` predates
 * the hand-rolled provider (ADR-0026) but is ours to own now, not a vendor
 * table — `id` is the stable `AuthPrincipal.subjectId` that
 * `users.auth_subject_id` links to. An auth flow only calls this once it has
 * verified ownership of the email, so we promote `emailVerified` to true when
 * a verifying flow (magic link / OAuth) confirms it.
 */
export async function upsertByEmail(
  input: { email: string; name: string; emailVerified: boolean; image?: string | null },
  tx: Executor = db
): Promise<AuthUserRow> {
  const email = input.email.toLowerCase();
  const existing = await findByEmail(email, tx);
  if (existing) {
    if (input.emailVerified && !existing.emailVerified) {
      const [row] = await tx
        .update(auth_user)
        .set({ emailVerified: true })
        .where(eq(auth_user.id, existing.id))
        .returning();
      return row ?? existing;
    }
    return existing;
  }
  const [row] = await tx
    .insert(auth_user)
    .values({
      id: newId(),
      email,
      name: input.name,
      emailVerified: input.emailVerified,
      image: input.image ?? null,
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

/** Permanently remove an auth identity. Cascades to `session` and `account` via FK. */
export async function deleteById(id: string, tx: Executor = db): Promise<void> {
  await tx.delete(auth_user).where(eq(auth_user.id, id));
}
