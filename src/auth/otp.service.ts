import { db } from "../../db";
import { authIdentityRepo } from "../repositories";
import { resolveUser } from "../services/identity.service";
import { sendAuthOtp, sendWelcomeEmail } from "./emails";
import { createOtp, type OtpConsumeResult } from "../lib/otp";
import {
  issueSession,
  principalOf,
  type IssuedTokens,
  type SessionContext,
} from "./session.service";

export const AUTH_OTP_TTL_SEC = 300;
export type AuthOtpConsumeResult = OtpConsumeResult;

const authOtp = createOtp({
  namespace: "auth-otp",
  ttlSec: AUTH_OTP_TTL_SEC,
  throttle: { max: 5, windowSec: 15 * 60 },
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function issueAuthOtp(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const code = await authOtp.issue(normalized);
  if (!code) return; // throttled — stay silent (no enumeration)
  await sendAuthOtp(normalized, code, "sign-in", AUTH_OTP_TTL_SEC);
}

export async function consumeAuthOtp(email: string, code: string): Promise<AuthOtpConsumeResult> {
  return authOtp.consume(normalizeEmail(email), code);
}

export async function verifyAuthOtp(
  email: string,
  code: string,
  ctx: SessionContext = {}
): Promise<{ result: AuthOtpConsumeResult; tokens?: IssuedTokens }> {
  const normalized = normalizeEmail(email);
  const result = await consumeAuthOtp(normalized, code);
  if (!result.ok) return { result };

  let created = false;
  let newUserId = "";
  const tokens = await db.transaction(async (tx) => {
    const identity = await authIdentityRepo.upsertByEmail(
      { email: normalized, name: normalized.split("@")[0] ?? "Thrivo user", emailVerified: true },
      tx
    );
    const resolved = await resolveUser(principalOf(identity), tx);
    created = resolved.created;
    newUserId = resolved.user.id;
    return issueSession(principalOf(identity), ctx, tx);
  });

  // Fired after commit, never inside the transaction — see identity.service.ts.
  if (created) await sendWelcomeEmail(normalized, newUserId);

  return { result, tokens };
}
