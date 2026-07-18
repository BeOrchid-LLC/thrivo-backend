import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk, timestamps } from "./_shared";
import { pushCampaignStatusEnum, pushRecipientStatusEnum } from "./_enums";
import { users } from "./users";

/**
 * Admin-composed one-off push broadcast. `segment` is a JSON audience filter
 * (`{ all?, tier?, subscriptionStatus?, lastActiveWithinDays? }`) resolved to
 * active push tokens at send time. Counts are denormalized rollups updated by
 * the send worker. Distinct from the per-user reminder schedules (user_settings)
 * and the daily-tip nudge (tips) — this is operator-initiated messaging.
 */
export const pushCampaigns = pgTable(
  "push_campaigns",
  {
    id: idPk(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    deepLink: text("deep_link"),
    segment: jsonb("segment").notNull(),
    status: pushCampaignStatusEnum("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    createdByAdminEmail: text("created_by_admin_email").notNull(),
    recipientCount: integer("recipient_count").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    statusCreatedIdx: index("push_campaigns_status_created_idx").on(t.status, t.createdAt),
  })
);

/** Per-recipient send ledger — one row per token targeted, for audit + idempotency. */
export const pushCampaignRecipients = pgTable(
  "push_campaign_recipients",
  {
    id: idPk(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => pushCampaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pushToken: text("push_token").notNull(),
    status: pushRecipientStatusEnum("status").notNull().default("queued"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCampaign: index("push_campaign_recipients_campaign_idx").on(t.campaignId),
  })
);

export const pushCampaignsRelations = relations(pushCampaigns, ({ many }) => ({
  recipients: many(pushCampaignRecipients),
}));

export const pushCampaignRecipientsRelations = relations(pushCampaignRecipients, ({ one }) => ({
  campaign: one(pushCampaigns, {
    fields: [pushCampaignRecipients.campaignId],
    references: [pushCampaigns.id],
  }),
  user: one(users, { fields: [pushCampaignRecipients.userId], references: [users.id] }),
}));

export type PushCampaignRow = typeof pushCampaigns.$inferSelect;
export type NewPushCampaignRow = typeof pushCampaigns.$inferInsert;
export type PushCampaignRecipientRow = typeof pushCampaignRecipients.$inferSelect;
export type NewPushCampaignRecipientRow = typeof pushCampaignRecipients.$inferInsert;
