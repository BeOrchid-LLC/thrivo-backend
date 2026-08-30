import { and, count, desc, eq, getTableColumns, ilike, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  foodFavorites,
  foodItems,
  foodLogs,
  foodNutrients,
  foodServings,
  type FoodStatus,
  type FoodTier,
  type FoodOrigin,
} from "../../db/schema";
import type {
  AdminFoodItemDetail,
  AdminFoodItemRow,
  AdminFoodNutrients,
  AdminFoodServing,
} from "../../contracts/src/admin-foods";
import * as adminAuditLogRepo from "./admin-audit-log.repository";
import type { AuditActor } from "./admin-audit-log.repository";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";

// numeric columns come back as strings from pg; parse at the boundary.
const num = (v: string | null): number | null => (v === null ? null : Number(v));

/** Correlated count of diary rows snapshotting this item — the reject/merge blast-radius. */
const logCountSql = sql<number>`(select count(*)::int from ${foodLogs} where ${foodLogs.foodItemId} = ${foodItems.id})`;

function toRow(r: {
  id: string;
  name: string;
  brand: string | null;
  tier: FoodTier;
  status: FoodStatus;
  origin: FoodOrigin;
  barcode: string | null;
  createdBy: string | null;
  verifiedAt: Date | null;
  logCount: number;
  createdAt: Date;
}): AdminFoodItemRow {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    tier: r.tier,
    status: r.status,
    origin: r.origin,
    barcode: r.barcode,
    createdBy: r.createdBy,
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    logCount: Number(r.logCount),
    createdAt: r.createdAt.toISOString(),
  };
}

export type ListFoodsParams = {
  cursor?: string;
  limit?: number;
  status?: FoodStatus;
  tier?: FoodTier;
  origin?: FoodOrigin;
  search?: string;
};
type FoodCursor = { createdAt: string; id: string };

/**
 * Keyset list of catalog items for moderation. `personal` items (owned by one
 * user, `owner_user_id` set) are always excluded — they're private, not
 * community content. Newest first; optional status/tier/origin filters + name
 * search.
 */
export async function listPaged(
  params: ListFoodsParams
): Promise<{ items: AdminFoodItemRow[]; limit: number; total: number; nextCursor: string | null }> {
  const limit = clampLimit(params.limit, 20, 100);
  const filters = [
    ne(foodItems.tier, "personal"),
    params.status ? eq(foodItems.status, params.status) : undefined,
    params.tier ? eq(foodItems.tier, params.tier) : undefined,
    params.origin ? eq(foodItems.origin, params.origin) : undefined,
    params.search ? ilike(foodItems.name, `%${params.search}%`) : undefined,
  ];
  const cursorWhere = params.cursor
    ? (() => {
        const c = decodeCursor<FoodCursor>(params.cursor!);
        return sql`(${foodItems.createdAt}, ${foodItems.id}) < (${c.createdAt}::timestamptz, ${c.id})`;
      })()
    : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        ...getTableColumns(foodItems),
        logCount: logCountSql,
        createdAtCursor: sql<string>`${foodItems.createdAt}::text`,
      })
      .from(foodItems)
      .where(and(...filters, cursorWhere))
      .orderBy(desc(foodItems.createdAt), desc(foodItems.id))
      .limit(limit),
    db
      .select({ value: count() })
      .from(foodItems)
      .where(and(...filters)),
  ]);

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ createdAt: last.createdAtCursor, id: last.id } satisfies FoodCursor)
      : null;

  return { items: rows.map(toRow), limit, total: Number(total), nextCursor };
}

function toNutrients(n: typeof foodNutrients.$inferSelect | undefined): AdminFoodNutrients | null {
  if (!n) return null;
  return {
    basis: n.basis,
    servingLabel: n.servingLabel,
    servingG: num(n.servingG),
    kcal: Number(n.kcal),
    proteinG: Number(n.proteinG),
    carbsG: Number(n.carbsG),
    fatG: Number(n.fatG),
    fiberG: num(n.fiberG),
    sugarG: num(n.sugarG),
    sodiumMg: num(n.sodiumMg),
    satFatG: num(n.satFatG),
    novaGroup: n.novaGroup,
  };
}

function toServing(s: typeof foodServings.$inferSelect): AdminFoodServing {
  return { id: s.id, label: s.label, grams: Number(s.grams), isDefault: s.isDefault };
}

/** Full detail for one non-personal item, or null if missing / personal. */
export async function findDetail(id: string): Promise<AdminFoodItemDetail | null> {
  const [item] = await db.select().from(foodItems).where(eq(foodItems.id, id)).limit(1);
  if (!item || item.tier === "personal") return null;

  const [nutrient, servings, [{ value: logCount }]] = await Promise.all([
    db.select().from(foodNutrients).where(eq(foodNutrients.foodItemId, id)).limit(1),
    db.select().from(foodServings).where(eq(foodServings.foodItemId, id)),
    db.select({ value: count() }).from(foodLogs).where(eq(foodLogs.foodItemId, id)),
  ]);

  return {
    ...toRow({ ...item, logCount: Number(logCount) }),
    ownerUserId: item.ownerUserId,
    mergedIntoId: item.mergedIntoId,
    nutrients: toNutrients(nutrient[0]),
    servings: servings.map(toServing),
  };
}

export async function mergePreview(
  id: string,
  mergeIntoId: string
): Promise<
  | {
      source: AdminFoodItemRow;
      target: AdminFoodItemRow;
      favoriteCount: number;
      logCount: number;
      alreadyMerged: boolean;
    }
  | "same_item"
  | "not_found"
  | "invalid_target"
  | "already_merged"
> {
  if (id === mergeIntoId) return "same_item";
  const [source, target] = await Promise.all([findDetail(id), findDetail(mergeIntoId)]);
  if (!source) return "not_found";
  if (source.status === "merged" || source.mergedIntoId) return "already_merged";
  if (!target || target.status === "merged" || target.mergedIntoId) return "invalid_target";
  const [{ value: favoriteCount }] = await db
    .select({ value: count() })
    .from(foodFavorites)
    .where(eq(foodFavorites.foodItemId, id));
  return {
    source,
    target,
    favoriteCount: Number(favoriteCount),
    logCount: source.logCount,
    alreadyMerged: false,
  };
}

type ModerationAction = "approve" | "reject" | "verify" | "unverify";

/**
 * Apply a status/verification transition, auditing the before/after in the same
 * transaction. Returns false if the item doesn't exist or is personal.
 */
export async function moderate(
  id: string,
  action: ModerationAction,
  audit: AuditActor,
  reason?: string
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(foodItems).where(eq(foodItems.id, id)).limit(1);
    if (!before || before.tier === "personal") return false;

    const patch: Partial<typeof foodItems.$inferInsert> = {};
    if (action === "approve") patch.status = "active";
    if (action === "reject") patch.status = "rejected";
    if (action === "verify") patch.verifiedAt = new Date();
    if (action === "unverify") patch.verifiedAt = null;

    const [after] = await tx.update(foodItems).set(patch).where(eq(foodItems.id, id)).returning();
    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: `food.${action}`,
        targetType: "food_item",
        targetId: id,
        before: { status: before.status, verifiedAt: before.verifiedAt },
        after: { status: after.status, verifiedAt: after.verifiedAt, reason: reason ?? null },
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return true;
  });
}

export type FoodEditInput = {
  name?: string;
  brand?: string | null;
  nutrients?: { kcal?: number; proteinG?: number; carbsG?: number; fatG?: number };
};

/** Edit identity/macros, auditing before/after. Returns false if missing/personal. */
export async function applyEdit(
  id: string,
  input: FoodEditInput,
  audit: AuditActor
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(foodItems).where(eq(foodItems.id, id)).limit(1);
    if (!before || before.tier === "personal") return false;
    const [beforeNutrients] = await tx
      .select()
      .from(foodNutrients)
      .where(eq(foodNutrients.foodItemId, id))
      .limit(1);

    const itemPatch: Partial<typeof foodItems.$inferInsert> = {};
    if (input.name !== undefined) itemPatch.name = input.name;
    if (input.brand !== undefined) itemPatch.brand = input.brand;
    if (Object.keys(itemPatch).length > 0) {
      await tx.update(foodItems).set(itemPatch).where(eq(foodItems.id, id));
    }

    if (input.nutrients && beforeNutrients) {
      const np: Partial<typeof foodNutrients.$inferInsert> = {};
      const n = input.nutrients;
      if (n.kcal !== undefined) np.kcal = String(n.kcal);
      if (n.proteinG !== undefined) np.proteinG = String(n.proteinG);
      if (n.carbsG !== undefined) np.carbsG = String(n.carbsG);
      if (n.fatG !== undefined) np.fatG = String(n.fatG);
      if (Object.keys(np).length > 0) {
        await tx.update(foodNutrients).set(np).where(eq(foodNutrients.foodItemId, id));
      }
    }

    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: "food.edit",
        targetType: "food_item",
        targetId: id,
        before: { name: before.name, brand: before.brand, nutrients: beforeNutrients ?? null },
        after: { name: input.name ?? before.name, brand: input.brand ?? before.brand },
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return true;
  });
}

export type MergeResult =
  "merged" | "not_found" | "invalid_target" | "same_item" | "already_merged";

/**
 * Merge `id` into `mergeIntoId`: mark the source `merged` with `mergedIntoId`
 * set, and repoint favorites to the survivor (skipping rows that would collide
 * with an existing favorite, then deleting the leftovers). `food_logs` are
 * already snapshotted, so historical entries are deliberately untouched.
 */
export async function merge(
  id: string,
  mergeIntoId: string,
  audit: AuditActor,
  reason?: string
): Promise<MergeResult> {
  if (id === mergeIntoId) return "same_item";
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(foodItems).where(eq(foodItems.id, id)).limit(1);
    if (!source || source.tier === "personal") return "not_found";
    if (source.status === "merged" || source.mergedIntoId) return "already_merged";
    const [target] = await tx
      .select()
      .from(foodItems)
      .where(eq(foodItems.id, mergeIntoId))
      .limit(1);
    if (!target || target.tier === "personal" || target.status === "merged" || target.mergedIntoId)
      return "invalid_target";

    await tx
      .update(foodItems)
      .set({ status: "merged", mergedIntoId: mergeIntoId })
      .where(eq(foodItems.id, id));

    // Repoint favorites; skip users who already favorite the survivor.
    await tx.execute(sql`
      update ${foodFavorites} set food_item_id = ${mergeIntoId}
      where ${foodFavorites.foodItemId} = ${id}
        and not exists (
          select 1 from ${foodFavorites} f2
          where f2.user_id = ${foodFavorites.userId} and f2.food_item_id = ${mergeIntoId}
        )`);
    await tx.delete(foodFavorites).where(eq(foodFavorites.foodItemId, id));

    await adminAuditLogRepo.append(
      {
        actorAdminEmail: audit.actorAdminEmail,
        action: "food.merge",
        targetType: "food_item",
        targetId: id,
        before: { status: source.status, mergedIntoId: source.mergedIntoId },
        after: { status: "merged", mergedIntoId: mergeIntoId, reason: reason ?? null },
        requestId: audit.requestId,
        ip: audit.ip,
      },
      tx
    );
    return "merged";
  });
}
