import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { uploads, type NewUploadRow, type UploadRow } from "../../db/schema";

export type Upload = UploadRow;

export async function createUpload(input: NewUploadRow, tx: Executor = db): Promise<Upload> {
  const [row] = await tx.insert(uploads).values(input).returning();
  return row;
}

/** Fetch an upload that belongs to the given user (ownership baked into the predicate — no IDOR). */
export async function getByIdForUser(
  id: string,
  userId: string,
  tx: Executor = db
): Promise<Upload | null> {
  const [row] = await tx
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function markVerified(
  id: string,
  patch: { size: number | null; contentType: string | null },
  tx: Executor = db
): Promise<Upload | null> {
  const now = new Date();
  const [row] = await tx
    .update(uploads)
    .set({
      status: "verified",
      size: patch.size,
      contentType: patch.contentType ?? undefined,
      uploadedAt: now,
      verifiedAt: now,
    })
    .where(eq(uploads.id, id))
    .returning();
  return row ?? null;
}

export async function markFailed(
  id: string,
  errorMessage: string,
  tx: Executor = db
): Promise<Upload | null> {
  const [row] = await tx
    .update(uploads)
    .set({ status: "failed", errorMessage })
    .where(eq(uploads.id, id))
    .returning();
  return row ?? null;
}
