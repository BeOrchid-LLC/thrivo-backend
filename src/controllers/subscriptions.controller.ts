import type { Context } from "hono";
import {
  cancelSubscriptionPayloadSchema,
  purchaseSubscriptionPayloadSchema,
  startTrialPayloadSchema,
} from "../../contracts/src/subscriptions";
import { respondOk } from "../lib/response";
import { getValidatedInput } from "../middleware/validate";
import {
  cancelSubscription,
  getSubscriptionState,
  purchaseSubscription,
  startTrial,
} from "../services/subscription.service";
import type { AppEnv } from "../types/http";

export async function getMySubscription(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const state = await getSubscriptionState(user);
  return respondOk(c, state);
}

export async function postStartTrial(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = startTrialPayloadSchema.parse(getValidatedInput(c, "json"));
  const state = await startTrial(user, input);
  return respondOk(c, state, "Trial started", 201);
}

export async function postPurchaseSubscription(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = purchaseSubscriptionPayloadSchema.parse(getValidatedInput(c, "json"));
  const state = await purchaseSubscription(user, input);
  return respondOk(c, state, "Subscription updated");
}

export async function postCancelSubscription(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const input = cancelSubscriptionPayloadSchema.parse(getValidatedInput(c, "json"));
  const state = await cancelSubscription(user, input);
  return respondOk(c, state, "Subscription cancelled");
}
