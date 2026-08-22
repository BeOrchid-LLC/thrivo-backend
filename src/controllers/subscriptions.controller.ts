import type { Context } from "hono";
import { respondOk } from "../lib/response";
import { getSubscriptionState } from "../services/subscription.service";
import { syncRevenueCatSubscription } from "../services/revenuecat.service";
import type { AppEnv } from "../types/http";
import { AppUpdateRequiredError } from "../lib/errors";

function rejectLegacyBillingMutation(): never {
  throw new AppUpdateRequiredError();
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

export async function postStartTrial(_c: Context<AppEnv>) {
  rejectLegacyBillingMutation();
}

export async function postPurchaseSubscription(_c: Context<AppEnv>) {
  rejectLegacyBillingMutation();
}

export async function postCancelSubscription(_c: Context<AppEnv>) {
  rejectLegacyBillingMutation();
}
