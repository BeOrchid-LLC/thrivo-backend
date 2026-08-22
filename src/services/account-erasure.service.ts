import { createHmac } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import { env } from "../env";
import { AppError } from "../lib/errors";
import { isR2Configured, deletePrefix } from "./r2.service";
import { accountErasureRepo, webhookEventRepo } from "../repositories";

const PRESIGNED_UPLOAD_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function identityDigest(value: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(value).digest("hex");
}

export async function requestAccountErasure(userId: string, authSubjectId: string, email: string) {
  const existing = await accountErasureRepo.findOpenByUser(userId);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    const duplicate = await accountErasureRepo.findOpenByAuthSubjectId(authSubjectId, tx);
    if (duplicate) return duplicate;
    const request = await accountErasureRepo.create(
      { userId, authSubjectId, rcAppUserId: userId },
      tx
    );
    await accountErasureRepo.addTombstone(
      "clerk",
      identityDigest(authSubjectId),
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      tx
    );
    await accountErasureRepo.addTombstone(
      "revenuecat",
      identityDigest(userId),
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      tx
    );
    const tombstoneEmail = `deleted+${request.id}@invalid.thrivo`;
    await tx
      .update(users)
      .set({
        email: tombstoneEmail,
        name: "Deleted user",
        image: null,
        authSubjectId: null,
        tier: "free",
        accountStatus: "free_plan",
        subscriptionStatus: null,
        trialEndsAt: null,
        deletedAt: new Date(),
      })
      .where(and(eq(users.id, userId), eq(users.email, email)));
    return request;
  });
}

async function deleteClerkIdentity(subjectId: string): Promise<void> {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  try {
    await clerk.users.deleteUser(subjectId);
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) return;
    throw error;
  }
}

function nextAttempt(attempt: number): Date {
  const minutes = [1, 5, 15, 60, 360, 720, 1440][Math.min(attempt - 1, 6)] ?? 1440;
  return new Date(Date.now() + minutes * 60 * 1000);
}

export async function processNextAccountErasure(): Promise<
  "none" | "completed" | "retrying" | "failed"
> {
  const request = await accountErasureRepo.claimNext();
  if (!request) return "none";
  try {
    if (request.authSubjectId) await deleteClerkIdentity(request.authSubjectId);
    if (request.rcAppUserId) {
      const { deleteRevenueCatCustomer } = await import("./revenuecat.service");
      await deleteRevenueCatCustomer(request.rcAppUserId);
    }

    const readyAt = request.requestedAt.getTime() + PRESIGNED_UPLOAD_TTL_MS;
    if (Date.now() < readyAt) {
      await accountErasureRepo.markRetryable(
        request.id,
        "WAITING_FOR_UPLOAD_TTL",
        new Date(readyAt)
      );
      return "retrying";
    }

    if (isR2Configured()) {
      await deletePrefix(`${env.R2_FOLDER_PREFIX}/user/${request.userId}/`);
    }
    await webhookEventRepo.redactForIdentifiers(
      [request.rcAppUserId, request.userId].filter((value): value is string => Boolean(value))
    );
    if (!request.userId) throw new Error("Erasure request has no user id");
    await db.delete(users).where(eq(users.id, request.userId));
    await accountErasureRepo.markCompleted(request.id, identityDigest(request.id));
    return "completed";
  } catch (error) {
    const code = error instanceof AppError ? error.code : "EXTERNAL_ERASURE_FAILURE";
    if (request.attempts >= MAX_ATTEMPTS) {
      await accountErasureRepo.markFailed(request.id, code);
      return "failed";
    }
    await accountErasureRepo.markRetryable(request.id, code, nextAttempt(request.attempts));
    return "retrying";
  }
}

export async function retryAccountErasure(id: string): Promise<void> {
  await accountErasureRepo.retry(id);
}
