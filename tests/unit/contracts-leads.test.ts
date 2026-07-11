import { describe, expect, it } from "vitest";
import {
  adminLeadListResponseSchema,
  adminLeadSchema,
  leadCapturePayloadSchema,
  leadCaptureResponseSchema,
  leadRoutes,
  leadSourceSchema,
} from "../../contracts/src";

describe("@beorchid-llc/thrivo-contracts -- leads", () => {
  it("validates and normalizes the capture payload", () => {
    const parsed = leadCapturePayloadSchema.parse({
      email: "Test@Example.com",
      source: "cta",
      utmSource: "newsletter",
    });
    expect(parsed.email).toBe("test@example.com");
    expect(parsed.source).toBe("cta");
    expect(parsed.utmMedium).toBeUndefined();
  });

  it("rejects an unknown source", () => {
    expect(
      leadCapturePayloadSchema.safeParse({ email: "a@b.com", source: "referral" }).success
    ).toBe(false);
  });

  it("keeps the capture response minimal (no enumeration signal)", () => {
    expect(leadCaptureResponseSchema.parse({ captured: true })).toEqual({ captured: true });
    expect(
      leadCaptureResponseSchema.safeParse({ captured: true, alreadyRegistered: true }).data
    ).toEqual({ captured: true });
  });

  it("parses an admin lead row and its paginated list envelope", () => {
    const lead = adminLeadSchema.parse({
      id: "018f6f1e-3d8b-7b30-8b82-bc7c81c1aef2",
      email: "lead@example.com",
      source: "cta",
      reconciledUserId: null,
      capturedAt: "2026-06-01T00:00:00.000Z",
      lastSubmittedAt: "2026-06-03T00:00:00.000Z",
      submissionCount: 2,
      country: "NG",
      deviceType: "mobile",
      osName: "iOS",
      osVersion: "18.0",
      browserName: "Safari",
      browserVersion: "18.0",
      referrer: "https://google.com",
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
    });
    expect(lead.submissionCount).toBe(2);

    const page = adminLeadListResponseSchema.parse({
      items: [lead],
      pagination: { limit: 20, total: 1, nextCursor: null },
    });
    expect(page.items[0]?.email).toBe("lead@example.com");
  });

  it("exports stable lead route metadata", () => {
    expect(leadRoutes.capture).toEqual({
      method: "POST",
      path: "/api/v1/leads/capture",
      auth: "public",
    });
    expect(leadRoutes.adminList).toEqual({
      method: "GET",
      path: "/api/v1/admin/leads",
      auth: "admin",
    });
    expect(leadRoutes.adminDelete).toEqual({
      method: "DELETE",
      path: "/api/v1/admin/leads/:id",
      auth: "admin",
    });
    expect(leadRoutes.adminExport).toEqual({
      method: "GET",
      path: "/api/v1/admin/leads/export",
      auth: "admin",
    });
    expect(leadSourceSchema.options).toEqual(["cta", "landing", "waitlist"]);
  });
});
