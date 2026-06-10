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
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tokenUniq: uniqueIndex("push_tokens_token_uniq").on(t.expoPushToken),
  })
);

export const pushTokensRelations = relations(pushTokens, ({ one }) => ({
  user: one(users, { fields: [pushTokens.userId], references: [users.id] }),
}));

export type PushTokenRow = typeof pushTokens.$inferSelect;
export type NewPushTokenRow = typeof pushTokens.$inferInsert;
