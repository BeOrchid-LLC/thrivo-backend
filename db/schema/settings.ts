import { boolean, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk, timestamps } from "./_shared";
import { users } from "./users";

export const globalSettings = pgTable("global_settings", {
  key: text("key").primaryKey().default("default"),
  pushNotificationsEnabled: boolean("push_notifications_enabled").notNull().default(true),
  dailyFoodLogReminderEnabled: boolean("daily_food_log_reminder_enabled").notNull().default(true),
  // Independent of the push flag above — a user may want one channel without
  // the other. Gates the weekly-review nudge email (send-weekly-review job).
  emailFoodLogReminderEnabled: boolean("email_food_log_reminder_enabled").notNull().default(true),
  weightCheckReminderEnabled: boolean("weight_check_reminder_enabled").notNull().default(true),
  hydrationReminderEnabled: boolean("hydration_reminder_enabled").notNull().default(true),
  subscriptionsEnabled: boolean("subscriptions_enabled").notNull().default(true),
  trialsEnabled: boolean("trials_enabled").notNull().default(true),
  purchasesEnabled: boolean("purchases_enabled").notNull().default(true),
  cancellationsEnabled: boolean("cancellations_enabled").notNull().default(true),
  trialDays: integer("trial_days").notNull().default(14),
  ...timestamps,
});

export const userSettings = pgTable(
  "user_settings",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    unitSystem: text("unit_system").notNull().default("metric"),
    pushNotificationsEnabled: boolean("push_notifications_enabled").notNull().default(true),
    dailyFoodLogReminderEnabled: boolean("daily_food_log_reminder_enabled").notNull().default(true),
    dailyFoodLogReminderTime: text("daily_food_log_reminder_time").notNull().default("08:00"),
    emailFoodLogReminderEnabled: boolean("email_food_log_reminder_enabled").notNull().default(true),
    weightCheckReminderEnabled: boolean("weight_check_reminder_enabled").notNull().default(true),
    weightCheckReminderDay: text("weight_check_reminder_day").notNull().default("friday"),
    weightCheckReminderTime: text("weight_check_reminder_time").notNull().default("09:00"),
    hydrationReminderEnabled: boolean("hydration_reminder_enabled").notNull().default(true),
    hydrationReminderIntervalMinutes: integer("hydration_reminder_interval_minutes")
      .notNull()
      .default(40),
    ...timestamps,
  },
  (t) => ({
    userUniq: uniqueIndex("user_settings_user_id_uniq").on(t.userId),
  })
);

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export type GlobalSettingsRow = typeof globalSettings.$inferSelect;
export type NewGlobalSettingsRow = typeof globalSettings.$inferInsert;
export type UserSettingsRow = typeof userSettings.$inferSelect;
export type NewUserSettingsRow = typeof userSettings.$inferInsert;
