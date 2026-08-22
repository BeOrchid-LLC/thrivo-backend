import { index, integer, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { idPk } from "./_shared";

/** Durable outbox/state machine for self-service and admin account erasure. */
export const accountErasureRequests = pgTable(
  "account_erasure_requests",
  {
    id: idPk(),
    userId: uuid("user_id"),
    authSubjectId: text("auth_subject_id"),
    rcAppUserId: text("rc_app_user_id"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: text("last_error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    proofDigest: text("proof_digest"),
  },
  (t) => ({
    statusAttemptIdx: index("account_erasure_status_attempt_idx").on(t.status, t.nextAttemptAt),
    userIdx: index("account_erasure_user_idx").on(t.userId),
  })
);

/** Pseudonymous denylist used to prevent stale auth/billing identities returning. */
export const identityTombstones = pgTable(
  "identity_tombstones",
  {
    id: idPk(),
    kind: text("kind").notNull(),
    digest: text("digest").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ digestUniq: uniqueIndex("identity_tombstones_kind_digest_uniq").on(t.kind, t.digest) })
);

export type AccountErasureRequestRow = typeof accountErasureRequests.$inferSelect;
export type IdentityTombstoneRow = typeof identityTombstones.$inferSelect;
