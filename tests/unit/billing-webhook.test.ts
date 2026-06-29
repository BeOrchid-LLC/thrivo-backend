import { describe, expect, it } from "vitest";
import { mapStatus, mapStore, signatureMatches } from "../../src/services/billing-webhook.service";

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
