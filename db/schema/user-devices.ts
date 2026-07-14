import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk, timestamps } from "./_shared";
import { platformEnum } from "./_enums";
import { users } from "./users";

/**
 * One row per user — "what device are they currently on", distinct from
 * `push_tokens` (a per-token push-delivery ledger that rotates and goes
 * inactive on re-registration, not a stable "current device" fact table).
 * Upserted on `userId`. Receiving end only for now — nothing in this codebase
 * writes to it yet; `osVersion`/`deviceModel` stay null until a future
 * mobile-app task reports them (e.g. at app-open or push-token registration).
 */
export const userDevices = pgTable(
  "user_devices",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform"),
    osVersion: text("os_version"),
    deviceModel: text("device_model"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    userIdUniq: uniqueIndex("user_devices_user_id_uniq").on(t.userId),
  })
);

export const userDevicesRelations = relations(userDevices, ({ one }) => ({
  user: one(users, { fields: [userDevices.userId], references: [users.id] }),
}));

export type UserDeviceRow = typeof userDevices.$inferSelect;
export type NewUserDeviceRow = typeof userDevices.$inferInsert;
