import { integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { citext, idPk, timestamps } from "./_shared";
import { goalEnum, sexEnum, userTierEnum } from "./_enums";
import { foodLogs } from "./food-logs";
import { foodFavorites } from "./food-favorites";
import { weightEntries } from "./weight-entries";
import { waterIntake } from "./water-intake";
import { checkIns } from "./check-ins";
import { pushTokens } from "./push-tokens";
import { dailySummaries } from "./daily-summaries";

/** Identity + onboarding profile + computed targets. Soft-deletable (GDPR recovery/audit). */
export const users = pgTable("users", {
  id: idPk(),
  email: citext("email").notNull().unique(),
  name: text("name").notNull(),

  // Neutral link to the provider-owned auth identity (auth_user.id). Nullable
  // until reconciled on first sign-in; keeps the domain table auth-agnostic.
  authSubjectId: text("auth_subject_id").unique(),

  // Onboarding profile (canonical SI; UI converts units at the edge).
  goal: goalEnum("goal"),
  sex: sexEnum("sex"),
  age: integer("age"),
  heightCm: numeric("height_cm", { precision: 5, scale: 1 }),
  weightKg: numeric("weight_kg", { precision: 5, scale: 1 }),
  targetWeightKg: numeric("target_weight_kg", { precision: 5, scale: 1 }),

  // Computed for everyone at onboarding; premium-gated at read time.
  tdeeKcal: integer("tdee_kcal"),
  dailyTargetKcal: integer("daily_target_kcal"),
  targetProteinG: integer("target_protein_g"),
  targetCarbsG: integer("target_carbs_g"),
  targetFatG: integer("target_fat_g"),
  activityLevel: text("activity_level"),
  manualDailyTargetKcal: integer("manual_daily_target_kcal"),

  // Nudge scheduling. Up to 3 daily reminder times (HH:mm:ss); labels are derived
  // in the client by position (Morning/Midday/Evening).
  notifyTimes: text("notify_times").array(),
  timezone: text("timezone"),

  // Entitlement (ADR-0014). subscriptionStatus is a denormalized mirror for fast
  // gating; the authoritative detail lives in `subscriptions`.
  tier: userTierEnum("tier").notNull().default("free"),
  accountStatus: text("account_status").notNull().default("dormant"),
  subscriptionStatus: text("subscription_status"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),

  onboardingStep: integer("onboarding_step").notNull().default(1),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
});

export const usersRelations = relations(users, ({ many }) => ({
  foodLogs: many(foodLogs),
  foodFavorites: many(foodFavorites),
  weightEntries: many(weightEntries),
  waterIntake: many(waterIntake),
  checkIns: many(checkIns),
  pushTokens: many(pushTokens),
  dailySummaries: many(dailySummaries),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
