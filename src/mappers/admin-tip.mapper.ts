import type { AdminTip, AdminTipMood } from "../../contracts/src/admin-content";
import type { Mood } from "../../db/schema";
import type { TipRow } from "../../db/schema";

/**
 * The check-in `mood` DB enum uses `ok`; the admin content contract labels the
 * same value `okay`. Translate on the boundary so neither side leaks the other's
 * spelling. Every other mood value is identical in both sets.
 */
export function dbMoodToAdmin(mood: Mood | null): AdminTipMood | null {
  if (mood === null) return null;
  return mood === "ok" ? "okay" : mood;
}

export function adminMoodToDb(mood: AdminTipMood | null | undefined): Mood | null {
  if (mood === null || mood === undefined) return null;
  return mood === "okay" ? "ok" : mood;
}

export function toAdminTip(row: TipRow): AdminTip {
  return {
    id: row.id,
    body: row.body,
    mood: dbMoodToAdmin(row.mood),
    isActive: row.isActive,
    // `pinnedDate` is a DATE column (YYYY-MM-DD text via drizzle), already the
    // contract's isoDateSchema shape; null when the tip isn't pinned.
    pinnedDate: row.pinnedDate,
    updatedAt: row.updatedAt.toISOString(),
  };
}
