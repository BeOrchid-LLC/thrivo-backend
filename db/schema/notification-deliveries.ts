import { date, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { idPk, timestamps } from "./_shared";
import { users } from "./users";

/** Idempotency ledger for scheduled per-user push deliveries. */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    localDate: date("local_date").notNull(),
    scheduledTime: text("scheduled_time").notNull(),
    status: text("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (t) => ({
    deliveryUniq: uniqueIndex("notification_deliveries_user_kind_time_uniq").on(
      t.userId,
      t.kind,
      t.localDate,
      t.scheduledTime
    ),
  })
);

export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDeliveryRow = typeof notificationDeliveries.$inferInsert;

export const notificationDeliveryStatuses = ["queued", "sent", "failed"] as const;
export type NotificationDeliveryStatus = (typeof notificationDeliveryStatuses)[number];
