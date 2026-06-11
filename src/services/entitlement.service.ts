import type { User } from "../repositories/user.repository";
import { PremiumRequiredError } from "../lib/errors";

/**
 * The one place free vs premium is decided. Reads `users.tier` — the denormalized
 * fast-path mirror of entitlement (ADR-0014); the authoritative subscription
 * detail lives in `subscriptions`, reconciled by the billing webhooks (A5).
 */
export function isPremium(user: User): boolean {
  return user.tier === "premium";
}

/** Throw `PremiumRequiredError` (403) unless the user is premium. */
export function assertPremium(user: User): void {
  if (!isPremium(user)) throw new PremiumRequiredError();
}
