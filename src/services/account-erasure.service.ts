import { createHmac } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import type { Tx } from "../../db/tx";
import { users } from "../../db/schema";
import { env } from "../env";
import { AppError } from "../lib/errors";
import { isR2Configured, deletePrefix } from "./r2.service";
import {
  accountErasureRepo,
  pushTokenRepo,
  subscriptionRepo,
  webhookEventRepo,
  webhookIdentityOwnershipRepo,
  emailLogRepo,
  emailCaptureRepo,
} from "../repositories";

const PRESIGNED_UPLOAD_TTL_MS = 15 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 8;
const RETRY_MINUTES = [1, 5, 15, 60, 360, 720, 1440];

export function identityDigest(value: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(value).digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

/** Accepts once and immediately locks the user; all destructive work is asynchronous. */
export async function requestAccountErasureInTransaction(
  userId: string,
  authSubjectId: string,
  email: string,
  tx: Tx
) {
  const concurrent = await accountErasureRepo.findOpenByUser(userId, tx);
  if (concurrent) return concurrent;
  const duplicate = await accountErasureRepo.findOpenByAuthSubjectId(authSubjectId, tx);
  if (duplicate) return duplicate;

  const subscription = await subscriptionRepo.getByUser(userId, tx);
  const ownershipDigests = await webhookIdentityOwnershipRepo.listDigestsByUser(userId, tx);
  const rcIds = new Set<string>(
    [subscription?.rcAppUserId, userId].filter((value): value is string => Boolean(value))
  );
  const request = await accountErasureRepo.create(
    { userId, authSubjectId, rcAppUserId: subscription?.rcAppUserId ?? userId },
    tx
  );
  const tombstoneBase =
    subscription?.currentPeriodEnd && subscription.currentPeriodEnd > request.requestedAt
      ? subscription.currentPeriodEnd
      : request.requestedAt;
  const revenueCatExpiry = new Date(tombstoneBase.getTime() + 365 * 24 * 60 * 60 * 1000);
  await accountErasureRepo.addTombstone(
    "clerk",
    identityDigest(authSubjectId),
    new Date(Date.now() + 24 * 60 * 60 * 1000),
    tx
  );
  for (const rcId of rcIds) {
    await accountErasureRepo.addTombstone("revenuecat", identityDigest(rcId), revenueCatExpiry, tx);
  }
  for (const digest of ownershipDigests) {
    await accountErasureRepo.addTombstone("revenuecat", digest, revenueCatExpiry, tx);
  }
  await pushTokenRepo.deactivateForUser(userId, tx);
  const anonymizedEmail = `deleted+${request.id}@invalid.thrivo`;
  await emailLogRepo.anonymizeRecipientForUser(userId, anonymizedEmail, tx);
  await emailCaptureRepo.anonymizeForUser(userId, anonymizedEmail, tx);
  await tx
    .update(users)
    .set({
      email: anonymizedEmail,
      name: "Deleted user",
      image: null,
      authSubjectId: null,
      tier: "free",
      accountStatus: "free_plan",
      subscriptionStatus: "none",
      trialEndsAt: null,
      deletedAt: new Date(),
    })
    .where(and(eq(users.id, userId), eq(users.email, email), isNull(users.deletedAt)));
  return request;
}

/** Accepts once and immediately locks the user; all destructive work is asynchronous. */
export async function requestAccountErasure(userId: string, authSubjectId: string, email: string) {
  const existing = await accountErasureRepo.findAnyByUser(userId);
  if (existing) return existing;

  try {
    return await db.transaction((tx) =>
      requestAccountErasureInTransaction(userId, authSubjectId, email, tx)
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return (
        (await accountErasureRepo.findOpenByUser(userId)) ??
        (await accountErasureRepo.findAnyByAuthSubjectId(authSubjectId))
      );
    }
    throw error;
  }
}

async function deleteClerkIdentity(subjectId: string): Promise<void> {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  try {
    await Promise.race([
      clerk.users.deleteUser(subjectId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("CLERK_DELETE_TIMEOUT")), 10_000)
      ),
    ]);
  } catch (error) {
    const typed = error as { status?: number; statusCode?: number } | null;
    const status = typed?.status ?? typed?.statusCode;
    if (status === 404) return;
    throw error;
  }
}

function nextAttempt(failures: number): Date {
  const minutes =
    RETRY_MINUTES[Math.min(Math.max(failures - 1, 0), RETRY_MINUTES.length - 1)] ?? 1440;
  return new Date(Date.now() + minutes * 60 * 1000);
}

function failureCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code)
    ? code
    : "EXTERNAL_ERASURE_FAILURE";
}

/** One lease-protected, phase-resumable unit of erasure work. */
export async function processNextAccountErasure(): Promise<
  "none" | "completed" | "retrying" | "failed"
> {
  const request = await accountErasureRepo.claimNext();
  if (!request) return "none";
  let phase = request.phase || "external_deletion";
  let consecutiveFailures = request.consecutiveFailures;
  try {
    if (phase === "external_deletion") {
      if (request.authSubjectId) await deleteClerkIdentity(request.authSubjectId);
      if (request.rcAppUserId) {
        const { deleteRevenueCatCustomer } = await import("./revenuecat.service");
        await deleteRevenueCatCustomer(request.rcAppUserId);
      }
      await accountErasureRepo.advancePhase(request.id, "upload_wait");
      phase = "upload_wait";
    }
    if (phase === "upload_wait") {
      const readyAt = request.requestedAt.getTime() + PRESIGNED_UPLOAD_TTL_MS;
      if (Date.now() < readyAt) {
        await accountErasureRepo.markRetryable(
          request.id,
          "WAITING_FOR_UPLOAD_TTL",
          new Date(readyAt),
          "upload_wait",
          consecutiveFailures
        );
        return "retrying";
      }
      await accountErasureRepo.advancePhase(request.id, "r2_deletion");
      phase = "r2_deletion";
    }
    if (phase === "r2_deletion") {
      if (isR2Configured() && request.userId)
        await deletePrefix(`${env.R2_FOLDER_PREFIX}/user/${request.userId}/`);
      await accountErasureRepo.advancePhase(request.id, "redaction");
      phase = "redaction";
    }
    if (phase === "redaction") {
      const digests = request.userId
        ? await webhookIdentityOwnershipRepo.listDigestsByUser(request.userId)
        : [];
      const identifiers = [request.rcAppUserId, request.userId].filter((v): v is string =>
        Boolean(v)
      );
      const eventIds = await webhookIdentityOwnershipRepo.listEventIdsByDigests([
        ...digests,
        ...identifiers.map(identityDigest),
      ]);
      await webhookEventRepo.redactByIds(eventIds);
      await webhookEventRepo.redactForIdentifiers(identifiers);
      await accountErasureRepo.advancePhase(request.id, "domain_deletion");
      phase = "domain_deletion";
    }
    if (phase === "domain_deletion") {
      if (!request.userId) throw new Error("ERASURE_USER_ID_MISSING");
      await db.delete(users).where(eq(users.id, request.userId));
      await accountErasureRepo.advancePhase(request.id, "finalization");
    }
    await accountErasureRepo.markCompleted(request.id, identityDigest(request.id));
    return "completed";
  } catch (error) {
    consecutiveFailures += 1;
    const code = failureCode(error);
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await accountErasureRepo.markFailed(request.id, code);
      return "failed";
    }
    await accountErasureRepo.markRetryable(
      request.id,
      code,
      nextAttempt(consecutiveFailures),
      phase,
      consecutiveFailures
    );
    return "retrying";
  }
}

export async function retryAccountErasure(id: string): Promise<void> {
  await accountErasureRepo.retry(id);
}
