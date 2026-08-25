import { and, asc, count, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { adminUsers, type AdminUserRow, type NewAdminUserRow } from "../../db/schema";
import type { AdminRole } from "../admin/otp.service";

export type AdminAccount = AdminUserRow;
export type AdminAccountStatus = "invited" | "active" | "disabled" | "revoked";

const norm = (email: string) => email.trim().toLowerCase();

/** Find an admin by their Clerk Admin app user ID. */
export async function findByClerkAdminId(
  clerkAdminId: string,
  tx: Executor = db
): Promise<AdminAccount | null> {
  const [row] = await tx
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.clerkAdminId, clerkAdminId))
    .limit(1);
  return row ?? null;
}

/** Link an existing admin row to a Clerk Admin app user ID. */
export async function linkClerkAdminId(
  id: string,
  clerkAdminId: string,
  tx: Executor = db
): Promise<void> {
  await tx.update(adminUsers).set({ clerkAdminId }).where(eq(adminUsers.id, id));
}

/** Find an admin by email (case-insensitive via citext). */
export async function findByEmail(email: string, tx: Executor = db): Promise<AdminAccount | null> {
  const [row] = await tx
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, norm(email)))
    .limit(1);
  return row ?? null;
}

export async function findById(id: string, tx: Executor = db): Promise<AdminAccount | null> {
  const [row] = await tx.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
  return row ?? null;
}

/** Every admin, oldest first — the management list is small (internal staff). */
export async function listAll(tx: Executor = db): Promise<AdminAccount[]> {
  return tx.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
}

/** Insert a new invited admin (no password yet). */
export async function insertInvited(
  input: { email: string; name: string; role: AdminRole; invitedByEmail: string | null },
  tx: Executor = db
): Promise<AdminAccount> {
  const values: NewAdminUserRow = {
    email: norm(input.email),
    name: input.name,
    role: input.role,
    status: "invited",
    passwordHash: null,
    invitedByEmail: input.invitedByEmail,
    inviteExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    inviteRevokedAt: null,
  };
  const [row] = await tx.insert(adminUsers).values(values).returning();
  return row;
}

/** Idempotent upsert used by the seed to guarantee the super admin exists. */
export async function upsertActive(
  input: { email: string; name: string; role: AdminRole; passwordHash: string },
  tx: Executor = db
): Promise<AdminAccount> {
  const [row] = await tx
    .insert(adminUsers)
    .values({
      email: norm(input.email),
      name: input.name,
      role: input.role,
      status: "active",
      passwordHash: input.passwordHash,
    })
    .onConflictDoUpdate({
      target: adminUsers.email,
      set: {
        name: input.name,
        role: input.role,
        status: "active",
        passwordHash: input.passwordHash,
      },
    })
    .returning();
  return row;
}

/** Bootstrap-only: insert an active admin with no password (env-allowlist migration). */
export async function upsertActiveNoPassword(
  input: { email: string; name: string | null; role: AdminRole },
  tx: Executor = db
): Promise<AdminAccount> {
  const [row] = await tx
    .insert(adminUsers)
    .values({
      email: norm(input.email),
      name: input.name,
      role: input.role,
      status: "active",
      passwordHash: null,
    })
    .onConflictDoNothing({ target: adminUsers.email })
    .returning();
  // onConflictDoNothing returns [] when the row already existed — fetch it.
  return row ?? ((await findByEmail(input.email, tx)) as AdminAccount);
}

/** Accept invite: set the first password and activate. */
export async function activateWithPassword(
  input: { email: string; passwordHash: string },
  tx: Executor = db
): Promise<AdminAccount> {
  const [row] = await tx
    .update(adminUsers)
    .set({ passwordHash: input.passwordHash, status: "active" })
    .where(eq(adminUsers.email, norm(input.email)))
    .returning();
  return row;
}

export async function setPassword(
  input: { email: string; passwordHash: string },
  tx: Executor = db
): Promise<void> {
  await tx
    .update(adminUsers)
    .set({ passwordHash: input.passwordHash })
    .where(eq(adminUsers.email, norm(input.email)));
}

export async function setLastLogin(id: string, tx: Executor = db): Promise<void> {
  await tx.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, id));
}

/** Patch name/role/status. Only provided fields are written. */
export async function update(
  id: string,
  patch: {
    name?: string;
    role?: AdminRole;
    status?: AdminAccountStatus;
    permissions?: string[] | null;
    inviteRevokedAt?: Date | null;
    clerkInvitationId?: string | null;
    inviteExpiresAt?: Date | null;
  },
  tx: Executor = db
): Promise<AdminAccount> {
  const [row] = await tx.update(adminUsers).set(patch).where(eq(adminUsers.id, id)).returning();
  return row;
}

/** Count active super-admins, optionally excluding one id — the anti-lockout guard. */
export async function countActiveSuperAdmins(
  excludeId: string | null,
  tx: Executor = db
): Promise<number> {
  const where = excludeId
    ? and(
        eq(adminUsers.role, "super-admin"),
        eq(adminUsers.status, "active"),
        ne(adminUsers.id, excludeId)
      )
    : and(eq(adminUsers.role, "super-admin"), eq(adminUsers.status, "active"));
  const [{ value }] = await tx.select({ value: count() }).from(adminUsers).where(where);
  return Number(value);
}
