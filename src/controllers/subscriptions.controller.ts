import type { Context } from "hono";
import { respondOk } from "../lib/response";
import { getSubscriptionState } from "../services/subscription.service";
import { syncRevenueCatSubscription } from "../services/revenuecat.service";
import type { AppEnv } from "../types/http";
import { AppUpdateRequiredError } from "../lib/errors";
import { env } from "../env";
import { getValidatedInput } from "../middleware/validate";
import {
  type CancelSubscriptionPayload,
  type PurchaseSubscriptionPayload,
  type StartTrialPayload,
} from "../../contracts/src/subscriptions";
import {
  cancelSubscription,
  purchaseSubscription,
  startTrial,
} from "../services/subscription.service";

function rejectLegacyBillingMutation(): never {
  throw new AppUpdateRequiredError();
}

function legacyMutationsEnabled(): boolean {
  return env.REVENUECAT_LEGACY_MUTATIONS === "enabled" && env.BILLING_PROVIDER === "disabled";
}

export async function getMySubscription(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const state = await getSubscriptionState(user);
  return respondOk(c, state);
}

export async function postSyncSubscription(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const state = await syncRevenueCatSubscription(user);
  return respondOk(c, state, "Subscription synchronized");
}

export async function postStartTrial(c: Context<AppEnv>) {
  if (!legacyMutationsEnabled()) rejectLegacyBillingMutation();
  const state = await startTrial(c.get("user")!, getValidatedInput(c, "json") as StartTrialPayload);
  return respondOk(c, state);
}

export async function postPurchaseSubscription(c: Context<AppEnv>) {
  if (!legacyMutationsEnabled()) rejectLegacyBillingMutation();
  const state = await purchaseSubscription(
    c.get("user")!,
    getValidatedInput(c, "json") as PurchaseSubscriptionPayload
  );
  return respondOk(c, state);
}

export async function postCancelSubscription(c: Context<AppEnv>) {
  if (!legacyMutationsEnabled()) rejectLegacyBillingMutation();
  const state = await cancelSubscription(
    c.get("user")!,
    getValidatedInput(c, "json") as CancelSubscriptionPayload
  );
  return respondOk(c, state);
}
