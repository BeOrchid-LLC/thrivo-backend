import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { users, type NewUserRow, type UserRow } from "../../db/schema";

export type User = UserRow;

/** Active = not soft-deleted. Every read excludes soft-deleted rows. */
export async function findById(id: string, tx: Executor = db): Promise<User | null> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function findActiveByEmail(email: string, tx: Executor = db): Promise<User | null> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function createUser(input: NewUserRow, tx: Executor = db): Promise<User> {
  const [row] = await tx.insert(users).values(input).returning();
  return row;
}

export async function updateProfile(
  id: string,
  patch: Partial<NewUserRow>,
  tx: Executor = db
): Promise<User | null> {
  const [row] = await tx
    .update(users)
    .set(patch)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning();
  return row ?? null;
}

/** GDPR-friendly soft delete (recovery/audit). Hard erasure cascades elsewhere. */
export async function softDeleteUser(id: string, tx: Executor = db): Promise<void> {
  await tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id));
}
