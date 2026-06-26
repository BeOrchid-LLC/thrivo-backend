import type { SubscriptionPlan } from "../../contracts/src/subscriptions";
import { env } from "../env";
import { UpstreamError } from "../lib/errors";

export interface BillingMutationInput {
  userId: string;
  productId: string;
  plan: SubscriptionPlan;
}

export interface BillingCancelInput {
  userId: string;
  productId: string | null;
  reason?: string;
}

export interface BillingMutationResult {
  confirmed: boolean;
  providerUserId: string | null;
  provider: "app_store" | "play_store" | "stripe";
}

export interface BillingAdapter {
  startTrial(input: BillingMutationInput): Promise<BillingMutationResult>;
  purchase(input: BillingMutationInput): Promise<BillingMutationResult>;
  cancel(input: BillingCancelInput): Promise<BillingMutationResult>;
}

function guardProductionStub(): void {
  if (env.NODE_ENV === "production") {
    throw new UpstreamError("Billing provider is not configured");
  }
}

const simulatedBillingAdapter: BillingAdapter = {
  async startTrial(input) {
    guardProductionStub();
    return { confirmed: true, providerUserId: input.userId, provider: "app_store" };
  },
  async purchase(input) {
    guardProductionStub();
    return { confirmed: true, providerUserId: input.userId, provider: "app_store" };
  },
  async cancel(input) {
    guardProductionStub();
    return { confirmed: true, providerUserId: input.userId, provider: "app_store" };
  },
};

export const billingAdapter: BillingAdapter = simulatedBillingAdapter;
