import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";

/** Durable result cache for repeatable high-risk admin requests. */
export const adminActionIdempotency = pgTable(
  "admin_action_idempotency",
  {
    id: idPk(),
    action: text("action").notNull(),
    targetId: text("target_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    response: jsonb("response"),
    responseMessage: text("response_message").notNull(),
    responseStatus: integer("response_status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actionTargetKeyUnique: uniqueIndex("admin_action_idempotency_action_target_key_uniq").on(
      t.action,
      t.targetId,
      t.idempotencyKey
    ),
    expiryIdx: index("admin_action_idempotency_expiry_idx").on(t.expiresAt),
  })
);

export type AdminActionIdempotencyRow = typeof adminActionIdempotency.$inferSelect;
