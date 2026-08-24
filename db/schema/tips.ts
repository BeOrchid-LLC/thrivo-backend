import { boolean, date, index, pgTable, text } from "drizzle-orm/pg-core";
import { idPk, timestamps } from "./_shared";
import { moodEnum } from "./_enums";

/**
 * Static psychology-tip bank. Powers the independently gated daily psychology-tip
 * push and the in-app check-in suggestion (`check_ins.tip_id`). Admin-managed (Phase 13 CRUD); `pinned_date`
 * lets staff force a specific tip on a given day, otherwise selection rotates
 * deterministically over the active set.
 */
export const tips = pgTable(
  "tips",
  {
    id: idPk(),
    body: text("body").notNull(),
    mood: moodEnum("mood"), // null = applies to any mood
    isActive: boolean("is_active").notNull().default(true),
    pinnedDate: date("pinned_date"),
    ...timestamps,
  },
  (t) => ({
    activeIdx: index("tips_active_idx").on(t.isActive),
    pinnedDateIdx: index("tips_pinned_date_idx").on(t.pinnedDate),
  })
);

export type TipRow = typeof tips.$inferSelect;
export type NewTipRow = typeof tips.$inferInsert;
