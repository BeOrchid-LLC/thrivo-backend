import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { tips, type Mood, type NewTipRow, type TipRow } from "../../db/schema";
import * as adminAuditLogRepo from "./admin-audit-log.repository";
import type { AuditActor } from "./admin-audit-log.repository";

export type Tip = TipRow;

export type TipWriteInput = {
  body: string;
  mood: Mood | null;
  isActive: boolean;
  pinnedDate: string | null;
};

/** Active tips in a stable order — the rotation set for the daily nudge. */
export async function listActive(tx: Executor = db): Promise<Tip[]> {
  return tx.select().from(tips).where(eq(tips.isActive, true)).orderBy(asc(tips.createdAt));
}

/** A tip explicitly pinned to a date by staff, if any (takes precedence). */
export async function getPinnedForDate(localDate: string, tx: Executor = db): Promise<Tip | null> {
  const [row] = await tx
    .select()
    .from(tips)
    .where(and(eq(tips.isActive, true), eq(tips.pinnedDate, localDate)))
    .limit(1);
  return row ?? null;
}

/** Batch resolve tips by id — used to attach tip bodies to a check-in list. */
export async function findByIds(ids: string[], tx: Executor = db): Promise<Map<string, Tip>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select().from(tips).where(inArray(tips.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function countAll(tx: Executor = db): Promise<number> {
  const rows = await tx.select({ id: tips.id }).from(tips);
  return rows.length;
}

/** Seed/import helper — used by the starter-bank seeder. */
export async function insertMany(rows: NewTipRow[], tx: Executor = db): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(tips).values(rows);
}

// ---------------------------------------------------------------------------
// Admin CRUD (audited). Each mutation writes its admin_audit_log row in the
// same transaction as the change (R3-1 pattern) so a rolled-back write never
// leaves an orphan audit entry.
// ---------------------------------------------------------------------------

/** Admin tip bank — offset-paginated, newest-first. */
export async function listPaged(
  params: { offset: number; limit: number },
  tx: Executor = db
): Promise<{ rows: Tip[]; total: number }> {
  const [rows, [{ value: total }]] = await Promise.all([
    tx
      .select()
      .from(tips)
      .orderBy(desc(tips.updatedAt), desc(tips.id))
      .limit(params.limit)
      .offset(params.offset),
    tx.select({ value: count() }).from(tips),
  ]);
  return { rows, total: Number(total) };
}

export async function findById(id: string, tx: Executor = db): Promise<Tip | null> {
  const [row] = await tx.select().from(tips).where(eq(tips.id, id)).limit(1);
  return row ?? null;
}

export async function create(input: TipWriteInput, audit: AuditActor): Promise<Tip> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(tips).values(input).returning();
    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: "tip.create",
        targetType: "tip",
        targetId: row.id,
        after: row,
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return row;
  });
}

export async function update(
  id: string,
  patch: Partial<TipWriteInput>,
  audit: AuditActor
): Promise<Tip | null> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(tips).where(eq(tips.id, id)).limit(1);
    if (!before) return null;

    const [row] = await tx.update(tips).set(patch).where(eq(tips.id, id)).returning();
    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: "tip.update",
        targetType: "tip",
        targetId: id,
        before,
        after: row,
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return row;
  });
}

/** Hard delete — `check_ins.tip_id` is a bare text column (no FK), so historical
 *  check-ins keep their tip id string and nothing cascades. Idempotent. */
export async function remove(id: string, audit: AuditActor): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(tips).where(eq(tips.id, id)).limit(1);
    if (!before) return false;

    await tx.delete(tips).where(eq(tips.id, id));
    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: "tip.delete",
        targetType: "tip",
        targetId: id,
        before,
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return true;
  });
}
