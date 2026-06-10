import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { citext, idPk } from "./_shared";
import { users } from "./users";

/** Pre-signup leads — no user FK at capture time; reconciled to a user by email on signup. */
export const emailCaptures = pgTable("email_captures", {
  id: idPk(),
  email: citext("email").notNull().unique(),
  source: text("source"), // 'landing', 'waitlist', ...
  reconciledUserId: uuid("reconciled_user_id").references(() => users.id, { onDelete: "set null" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmailCaptureRow = typeof emailCaptures.$inferSelect;
export type NewEmailCaptureRow = typeof emailCaptures.$inferInsert;
