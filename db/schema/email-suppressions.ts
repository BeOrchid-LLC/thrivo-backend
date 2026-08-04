import { boolean, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { citext, idPk, timestamps } from "./_shared";
import { emailSuppressionReasonEnum } from "./_enums";

/** Local deliverability guard populated from adverse provider events. */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: idPk(),
    email: citext("email").notNull(),
    reason: emailSuppressionReasonEnum("reason").notNull(),
    providerEventId: text("provider_event_id"),
    active: boolean("active").notNull().default(true),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }).notNull().defaultNow(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({ emailUniq: uniqueIndex("email_suppressions_email_uniq").on(t.email) })
);

export type EmailSuppressionRow = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppressionRow = typeof emailSuppressions.$inferInsert;
