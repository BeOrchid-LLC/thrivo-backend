import type { Context } from "hono";
import {
  cancelSubscriptionPayloadSchema,
  purchaseSubscriptionPayloadSchema,
  startTrialPayloadSchema,
} from "../../contracts/src/subscriptions";
import { respondOk } from "../lib/response";
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
  const validJson = c.req.valid as (target: "json") => unknown;
  const input = startTrialPayloadSchema.parse(validJson("json"));
  const state = await startTrial(user, input);
  return respondOk(c, state, "Trial started", 201);
}

export async function postPurchaseSubscription(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const validJson = c.req.valid as (target: "json") => unknown;
  const input = purchaseSubscriptionPayloadSchema.parse(validJson("json"));
  const state = await purchaseSubscription(user, input);
  return respondOk(c, state, "Subscription updated");
}

export async function postCancelSubscription(c: Context<AppEnv>) {
  const user = c.get("user")!;
  const validJson = c.req.valid as (target: "json") => unknown;
  const input = cancelSubscriptionPayloadSchema.parse(validJson("json"));
  const state = await cancelSubscription(user, input);
  return respondOk(c, state, "Subscription cancelled");
}
