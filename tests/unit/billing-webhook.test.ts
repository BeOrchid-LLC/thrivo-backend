import { describe, expect, it } from "vitest";
import {
  classifySubscriptionEvent,
  extractPriceFields,
  mapStatus,
  mapStore,
  signatureMatches,
} from "../../src/services/billing-webhook.service";

describe("billing-webhook signature", () => {
  it("matches the exact shared secret", () => {
    expect(signatureMatches("s3cret-value", "s3cret-value")).toBe(true);
  });

  it("rejects a wrong secret of equal length", () => {
    expect(signatureMatches("s3cret-valuE", "s3cret-value")).toBe(false);
  });

  it("rejects a different-length secret without throwing", () => {
    expect(signatureMatches("short", "a-much-longer-secret")).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    expect(signatureMatches("anything", undefined)).toBe(false);
    expect(signatureMatches("anything", "")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(signatureMatches(undefined, "s3cret")).toBe(false);
  });
});

describe("revenuecat event mapping", () => {
  it("maps purchases/renewals to active, trials to trialing", () => {
    expect(mapStatus("INITIAL_PURCHASE", "NORMAL")).toBe("active");
    expect(mapStatus("INITIAL_PURCHASE", "TRIAL")).toBe("trialing");
    expect(mapStatus("RENEWAL", "NORMAL")).toBe("active");
    expect(mapStatus("UNCANCELLATION", "NORMAL")).toBe("active");
  });

  it("maps cancellation, expiration and billing issues", () => {
    expect(mapStatus("CANCELLATION", "NORMAL")).toBe("canceled");
    expect(mapStatus("EXPIRATION", "NORMAL")).toBe("expired");
    expect(mapStatus("BILLING_ISSUE", "NORMAL")).toBe("in_grace");
  });

  it("ignores unmapped event types (recorded, not applied)", () => {
    expect(mapStatus("TRANSFER", null)).toBeNull();
    expect(mapStatus("SUBSCRIBER_ALIAS", null)).toBeNull();
    expect(mapStatus("TEST", null)).toBeNull();
  });

  it("maps the store to our provider enum", () => {
    expect(mapStore("PLAY_STORE")).toBe("play_store");
    expect(mapStore("STRIPE")).toBe("stripe");
    expect(mapStore("APP_STORE")).toBe("app_store");
    expect(mapStore(undefined)).toBe("app_store");
  });
});

describe("subscription funnel classification", () => {
  it("classifies a trial start", () => {
    expect(classifySubscriptionEvent("INITIAL_PURCHASE", "TRIAL", null)).toBe("trial_started");
  });

  it("classifies a trial converting to a paid renewal/product change", () => {
    expect(classifySubscriptionEvent("RENEWAL", "NORMAL", "trialing")).toBe("trial_converted");
    expect(classifySubscriptionEvent("PRODUCT_CHANGE", "NORMAL", "trialing")).toBe(
      "trial_converted"
    );
    expect(classifySubscriptionEvent("UNCANCELLATION", "NORMAL", "trialing")).toBe(
      "trial_converted"
    );
  });

  it("does not classify a RENEWAL as a conversion while still in TRIAL period_type", () => {
    expect(classifySubscriptionEvent("RENEWAL", "TRIAL", "trialing")).toBeNull();
  });

  it("classifies a cancellation during a trial as trial_cancelled", () => {
    expect(classifySubscriptionEvent("CANCELLATION", "NORMAL", "trialing")).toBe("trial_cancelled");
  });

  it("records a regular cancellation in the billing history", () => {
    expect(classifySubscriptionEvent("CANCELLATION", "NORMAL", "active")).toBe("canceled");
  });

  it("classifies a non-trial renewal as renewed", () => {
    expect(classifySubscriptionEvent("RENEWAL", "NORMAL", "active")).toBe("renewed");
  });

  it("classifies EXPIRATION regardless of prior status", () => {
    expect(classifySubscriptionEvent("EXPIRATION", null, "trialing")).toBe("expired");
    expect(classifySubscriptionEvent("EXPIRATION", null, "active")).toBe("expired");
  });

  it("ignores event types outside the funnel", () => {
    expect(classifySubscriptionEvent("BILLING_ISSUE", "NORMAL", "active")).toBe("billing_issue");
    expect(classifySubscriptionEvent("TRANSFER", null, null)).toBeNull();
  });
});

describe("price field extraction", () => {
  it("converts price_in_purchased_currency to integer cents", () => {
    expect(extractPriceFields({ price_in_purchased_currency: 14.99, currency: "USD" })).toEqual({
      priceAmountCents: 1499,
      currency: "USD",
    });
  });

  it("keeps a free-trial $0 as 0, not null — RevenueCat sends 0, not absent", () => {
    expect(extractPriceFields({ price_in_purchased_currency: 0, currency: "USD" })).toEqual({
      priceAmountCents: 0,
      currency: "USD",
    });
  });

  it("keeps a refund's negative price as negative cents", () => {
    expect(extractPriceFields({ price_in_purchased_currency: -14.99, currency: "USD" })).toEqual({
      priceAmountCents: -1499,
      currency: "USD",
    });
  });

  it("stays null (never fabricated as 0) when the field is missing or null", () => {
    expect(extractPriceFields({})).toEqual({ priceAmountCents: null, currency: null });
    expect(extractPriceFields({ price_in_purchased_currency: null, currency: null })).toEqual({
      priceAmountCents: null,
      currency: null,
    });
  });

  it("rounds fractional-cent prices to the nearest cent", () => {
    expect(extractPriceFields({ price_in_purchased_currency: 9.994 }).priceAmountCents).toBe(999);
    expect(extractPriceFields({ price_in_purchased_currency: 9.996 }).priceAmountCents).toBe(1000);
  });

  it("normalizes ISO currency and leaves invalid currency unknown", () => {
    expect(extractPriceFields({ price_in_purchased_currency: 4, currency: " eur " })).toEqual({
      priceAmountCents: 400,
      currency: "EUR",
    });
    expect(extractPriceFields({ price_in_purchased_currency: 4, currency: "US" })).toEqual({
      priceAmountCents: 400,
      currency: null,
    });
  });
});
