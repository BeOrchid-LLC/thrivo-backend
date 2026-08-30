import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";
import { emailCaptures } from "./email-captures";

export const leadNotes = pgTable(
  "lead_notes",
  {
    id: idPk(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => emailCaptures.id, { onDelete: "cascade" }),
    authorAdminEmail: text("author_admin_email").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ leadCreatedIdx: index("lead_notes_lead_created_idx").on(t.leadId, t.createdAt) })
);

export type LeadNoteRow = typeof leadNotes.$inferSelect;
export type NewLeadNoteRow = typeof leadNotes.$inferInsert;
