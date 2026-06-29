import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { idPk, timestamps } from "./_shared";
import { uploadStatusEnum } from "./_enums";
import { users } from "./users";

/**
 * Tracks every presigned R2 upload through its lifecycle (Postgres port of
 * pinpoint-backend's Mongo `Document` model). A row is created `pending` when a
 * presigned URL is minted and flipped to `verified` once HeadObject confirms the
 * object exists. Generic by design — `entityType`/`intent` let one table serve
 * avatars today and progress/meal photos later. `userId` is always the uploader
 * (for ownership checks and orphan cleanup), independent of the target entity.
 */
export const uploads = pgTable(
  "uploads",
  {
    id: idPk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // What the object belongs to and what it's for (e.g. entityType="user",
    // intent="avatar"). Kept as text so new kinds don't require a migration.
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    intent: text("intent").notNull(),

    // R2 object key (unique) and its public read URL.
    key: text("key").notNull().unique(),
    publicUrl: text("public_url").notNull(),

    contentType: text("content_type"),
    fileExtension: text("file_extension"),

    status: uploadStatusEnum("status").notNull().default("pending"),
    size: integer("size"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    errorMessage: text("error_message"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    byUser: index("uploads_user_idx").on(t.userId),
    byStatus: index("uploads_status_idx").on(t.status),
  })
);

export const uploadsRelations = relations(uploads, ({ one }) => ({
  user: one(users, { fields: [uploads.userId], references: [users.id] }),
}));

export type UploadRow = typeof uploads.$inferSelect;
export type NewUploadRow = typeof uploads.$inferInsert;
