import type { AdminTimelineEntry } from "../../contracts/src/admin";
import { subscriptionEventRepo, subscriptionRepo, userEventRepo, userRepo } from "../repositories";
import { NotFoundError } from "../lib/errors";
import { PLAN_PRICE_CENTS, subscriptionPlans } from "./subscription.service";

const SUBSCRIPTION_EVENT_TITLES: Record<string, string> = {
  trial_started: "7-day trial started",
  trial_cancelled: "Trial cancelled",
  renewed: "Renewed",
  expired: "Expired",
  canceled: "Canceled",
  billing_issue: "Billing issue",
  refunded: "Refunded",
  refund_reversed: "Refund reversed",
  product_changed: "Product changed",
  subscription_extended: "Subscription extended",
};

function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function extractTrigger(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "trigger" in metadata) {
    const trigger = (metadata as { trigger: unknown }).trigger;
    return typeof trigger === "string" ? trigger : null;
  }
  return null;
}

function subscriptionEntryTitle(eventType: string, priceAmountCents: number | null): string {
  if (eventType === "trial_converted") {
    return priceAmountCents !== null
      ? `Trial converted — charged ${formatUsdCents(priceAmountCents)}`
      : "Trial converted";
  }
  return SUBSCRIPTION_EVENT_TITLES[eventType] ?? eventType;
}

function monthlyEquivalentCents(productId: string | null): number | null {
  if (productId === subscriptionPlans.monthly.productId) return PLAN_PRICE_CENTS.monthly;
  if (productId === subscriptionPlans.annual.productId) {
    return Math.round(PLAN_PRICE_CENTS.annual / 12);
  }
  return null;
}

/**
 * Merges subscription_events + user_events + synthesized account_created/
 * onboarding_completed/next_charge_scheduled entries into one time-sorted
 * timeline. Entries are only ever added when real data backs them — no
 * fabricated context (e.g. no "Card added" subtitle unless that's ever
 * actually tracked).
 */
export async function getUserTimeline(userId: string): Promise<AdminTimelineEntry[]> {
  const user = await userRepo.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  const [subEvents, prodEvents, subscription] = await Promise.all([
    subscriptionEventRepo.listByUser(userId),
    userEventRepo.listByUser(userId),
    subscriptionRepo.getByUser(userId),
  ]);

  const entries: AdminTimelineEntry[] = [
    {
      type: "account_created",
      title: "Account created",
      subtitle: null,
      occurredAt: user.createdAt.toISOString(),
      status: "completed",
    },
  ];

  if (user.onboardingCompletedAt) {
    entries.push({
      type: "onboarding_completed",
      title: "Onboarding completed",
      subtitle: null,
      occurredAt: user.onboardingCompletedAt.toISOString(),
      status: "completed",
    });
  }

  for (const e of prodEvents) {
    if (e.eventType !== "upgrade_prompt_shown") continue; // onboarding_completed synthesized above
    const trigger = extractTrigger(e.metadata);
    entries.push({
      type: "upgrade_prompt_shown",
      title: "Upgrade prompt shown",
      subtitle: trigger ? `${trigger} trigger` : null,
      occurredAt: e.occurredAt.toISOString(),
      status: "completed",
    });
  }

  for (const e of subEvents) {
    entries.push({
      type: e.eventType,
      title: subscriptionEntryTitle(e.eventType, e.priceAmountCents),
      subtitle: null,
      occurredAt: e.occurredAt.toISOString(),
      status: "completed",
    });
  }

  const isLive =
    subscription &&
    !subscription.cancelAtPeriodEnd &&
    (subscription.status === "active" || subscription.status === "trialing") &&
    subscription.currentPeriodEnd;
  if (isLive && subscription) {
    const cents = monthlyEquivalentCents(subscription.productId);
    entries.push({
      type: "next_charge_scheduled",
      title: cents !== null ? `Next charge — ${formatUsdCents(cents)}` : "Next charge scheduled",
      subtitle: "Scheduled",
      occurredAt: subscription.currentPeriodEnd!.toISOString(),
      status: "scheduled",
    });
  }

  entries.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  return entries;
}
