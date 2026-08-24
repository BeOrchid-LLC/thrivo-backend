import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk, timestamps } from "./_shared";
import { platformEnum } from "./_enums";
import { users } from "./users";

/** Expo push tokens per device. A user may have several (phone + tablet, re-registrations). */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expoPushToken: text("expo_push_token").notNull(),
    platform: platformEnum("platform").notNull(),
    // Nullable for legacy registrations; new mobile builds send this stable
    // app-install identifier so token refreshes can retire the old row.
    deviceId: text("device_id"),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tokenUniq: uniqueIndex("push_tokens_token_uniq").on(t.expoPushToken),
    userDeviceUniq: uniqueIndex("push_tokens_user_device_uniq").on(t.userId, t.deviceId),
  })
);

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, { fields: [pushTokens.userId], references: [users.id] }),
}));

export type PushTokenRow = typeof pushTokens.$inferSelect;
export type NewPushTokenRow = typeof pushTokens.$inferInsert;
