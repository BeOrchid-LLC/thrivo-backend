import { db } from "../../db";
import { accountDeletionWebRequestRepo, accountErasureRepo, userRepo } from "../repositories";
import {
  accountDeletionConfirmationPayloadSchema,
  accountDeletionRequestPayloadSchema,
} from "../../contracts/src/account-deletion";
import { sha256Hex, randomToken } from "../lib/crypto";
import { emailPublicLink } from "../lib/email/links";
import { queueTemplatedEmail } from "./email.service";
import { requestAccountErasureInTransaction } from "./account-erasure.service";
import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import { RateLimitedError, ValidationError } from "../lib/errors";

const TOKEN_TTL_MS = 30 * 60 * 1000;
const EMAIL_RATE_WINDOW_SECONDS = 15 * 60;
const EMAIL_RATE_MAX = 3;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

async function checkEmailRateLimit(email: string): Promise<void> {
  const key = `rl:account-deletion-email:${sha256Hex(email)}`;
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, EMAIL_RATE_WINDOW_SECONDS);
    if (count > EMAIL_RATE_MAX) throw new RateLimitedError("Too many requests");
  } catch (error) {
    if (error instanceof RateLimitedError) throw error;
    logger.warn({ err: error }, "account deletion email limiter unavailable; failing open");
  }
}

export async function requestWebAccountDeletion(input: unknown): Promise<void> {
  const { email } = accountDeletionRequestPayloadSchema.parse(input);
  await checkEmailRateLimit(email);

  try {
    await db.transaction(async (tx) => {
      const user = await userRepo.findActiveByEmail(email, tx);
      if (!user) return;

      const existing = await accountDeletionWebRequestRepo.findPendingByUser(user.id, tx);
      if (existing && existing.expiresAt > new Date()) return;

      const token = randomToken();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      const request = await accountDeletionWebRequestRepo.create(
        { userId: user.id, tokenHash: sha256Hex(token), expiresAt },
        tx
      );

      await queueTemplatedEmail({
        kind: "account_deletion",
        to: email,
        template: "account-deletion",
        props: {
          url: emailPublicLink(`/delete-account?token=${encodeURIComponent(token)}`),
          expiresInMinutes: 30,
        },
        expiresAt,
        dedupeKey: `account-deletion:${request.id}`,
        userId: user.id,
        transaction: tx,
      });
    });
  } catch (error) {
    // Another request won the single-pending-request race. The public contract
    // intentionally has the same response for this case.
    if (!isUniqueViolation(error)) throw error;
  }
}

export async function confirmWebAccountDeletion(input: unknown): Promise<{ status: "queued" }> {
  const { token } = accountDeletionConfirmationPayloadSchema.parse(input);
  const tokenHash = sha256Hex(token);

  await db.transaction(async (tx) => {
    const request = await accountDeletionWebRequestRepo.findByTokenHashForUpdate(tokenHash, tx);
    if (!request) throw new ValidationError("This deletion link is invalid or expired");
    if (request.status === "confirmed" && request.erasureRequestId) return;
    if (request.status !== "pending" || request.expiresAt <= new Date()) {
      await accountDeletionWebRequestRepo.markExpired(request.id, tx);
      throw new ValidationError("This deletion link is invalid or expired");
    }
    if (!request.userId) throw new ValidationError("This deletion link is invalid or expired");

    const existing = await accountErasureRepo.findAnyByUser(request.userId, tx);
    const user = existing ? null : await userRepo.findById(request.userId, tx);
    const erasure =
      existing ??
      (user
        ? await requestAccountErasureInTransaction(
            user.id,
            user.authSubjectId ?? `web:${user.id}`,
            user.email,
            tx
          )
        : null);
    if (!erasure) throw new ValidationError("This deletion link is invalid or expired");
    await accountDeletionWebRequestRepo.markConfirmed(request.id, erasure.id, new Date(), tx);
  });

  return { status: "queued" };
}

/** Retain only a short-lived audit trail of external requests. */
export async function purgeOldWebAccountDeletionRequests(): Promise<void> {
  await accountDeletionWebRequestRepo.purgeBefore(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
}
