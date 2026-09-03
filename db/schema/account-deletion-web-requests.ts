import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";
import { users } from "./users";
import { accountErasureRequests } from "./account-erasure";

/** Public account-deletion verification requests. Raw tokens are never stored. */
export const accountDeletionWebRequests = pgTable(
  "account_deletion_web_requests",
  {
    id: idPk(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    erasureRequestId: uuid("erasure_request_id").references(() => accountErasureRequests.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    tokenHashUniq: uniqueIndex("account_deletion_web_requests_token_hash_uniq").on(t.tokenHash),
    pendingUserUniq: uniqueIndex("account_deletion_web_requests_pending_user_uniq")
      .on(t.userId)
      .where(sql`${t.status} = 'pending'`),
    userIdx: index("account_deletion_web_requests_user_idx").on(t.userId),
    statusExpiryIdx: index("account_deletion_web_requests_status_expiry_idx").on(
      t.status,
      t.expiresAt
    ),
  })
);

export type AccountDeletionWebRequestRow = typeof accountDeletionWebRequests.$inferSelect;
