import { describe, expect, it } from "vitest";
import { renderTemplate } from "../../src/lib/email/registry";

describe("email template registry", () => {
  it("renders the otp template with the code and a purpose-specific subject", () => {
    const out = renderTemplate("otp", { code: "123456", purpose: "sign-in", expiresInMinutes: 5 });
    expect(out.subject).toContain("123456");
    expect(out.subject).toContain("sign-in");
    // Each digit renders in its own box, so the html never has "123456" contiguous — the plain-text
    // fallback does.
    expect(out.html).toContain(">1<");
    expect(out.html).toContain(">6<");
    expect(out.text).toContain("123456");
  });

  it("renders the otp template's recipient and expiry with a transactional footer", () => {
    const out = renderTemplate(
      "otp",
      { code: "123456", purpose: "email-verification", expiresInMinutes: 5 },
      {
        recipientEmail: "maya@example.com",
      }
    );
    expect(out.html).toContain("Sent to maya@example.com");
    expect(out.html).not.toContain("unsubscribe");
    expect(out.html).toContain("expires in 5 minutes");
  });

  it("renders the magic-link template with the sign-in url and expiry", () => {
    const out = renderTemplate(
      "magic-link",
      {
        url: "https://thrivo.fit/api/v1/auth/magic-link/callback?token=abc123",
        expiresInMinutes: 15,
      },
      {
        recipientEmail: "maya@example.com",
      }
    );
    expect(out.subject).toBe("Your Thrivo sign-in link");
    expect(out.html).toContain("Here&#39;s your sign-in link");
    expect(out.html).toContain("https://thrivo.fit/api/v1/auth/magic-link/callback?token=abc123");
    expect(out.html).toContain("expires in 15 minutes");
    expect(out.html).toContain("Sent to maya@example.com");
    expect(out.text).toContain("https://thrivo.fit/api/v1/auth/magic-link/callback?token=abc123");
  });

  it("renders the weekly-review template with the exact completed period and opt-out link", () => {
    const out = renderTemplate(
      "weekly-review",
      {
        periodStart: "2024-01-14",
        periodEnd: "2024-01-20",
        loggedDays: 7,
        previousLoggedDays: 4,
        includeComparison: true,
        joinedDuringPeriod: false,
        progressUrl: "https://thrivo.fit/metrics",
      },
      {
        recipientEmail: "maya@example.com",
        unsubscribeUrl: "https://thrivo.fit/unsubscribe?token=signed-token",
      }
    );
    expect(out.subject).toBe("Your Thrivo week: 7 of 7 days logged");
    expect(out.html).toContain(">100%<");
    expect(out.html).toContain("7 of 7 days");
    expect(out.html).toContain("Jan 14, 2024");
    expect(out.html).toContain("Jan 20, 2024");
    expect(out.html).toContain("3 more days than the previous week");
    expect(out.html).toContain("Sent to maya@example.com");
    expect(out.text).toContain("View your progress: https://thrivo.fit/metrics");
    expect(out.html).toContain("https://thrivo.fit/unsubscribe?token=signed-token");
  });

  it("uses neutral join-aware wording and omits an unhelpful comparison", () => {
    const out = renderTemplate(
      "weekly-review",
      {
        periodStart: "2024-01-14",
        periodEnd: "2024-01-20",
        loggedDays: 0,
        previousLoggedDays: 0,
        includeComparison: false,
        joinedDuringPeriod: true,
        progressUrl: "https://thrivo.fit/metrics",
      },
      undefined
    );
    expect(out.html).toContain("You joined partway through this week");
    expect(out.html).not.toContain("previous week");
  });

  it("renders the notification template with subject, html and text", () => {
    const out = renderTemplate("notification", {
      title: "Welcome to Thrivo",
      body: "Let's hit your goals.",
      cta: { label: "Open app", url: "https://thrivo.fit/app" },
    });

    expect(out.subject).toBe("Welcome to Thrivo");
    expect(out.html).toContain("Welcome to Thrivo");
    expect(out.html).toContain("Let&#39;s hit your goals.");
    expect(out.html).toContain("https://thrivo.fit/app");
    expect(out.text).toContain("Open app: https://thrivo.fit/app");
    expect(out.html).toContain('src="cid:thrivo-logo"');
    expect(out.html).not.toContain("<svg");
    expect(out.attachments).toEqual([
      expect.objectContaining({
        filename: "thrivo-logo.png",
        contentType: "image/png",
        contentId: "thrivo-logo",
      }),
    ]);
  });

  it("escapes HTML in props to prevent markup injection", () => {
    const out = renderTemplate("notification", {
      title: "<script>alert(1)</script>",
      body: "plain",
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("renders the notification template's recipient/unsubscribe footer and dark-mode CSS — it no longer has neither on the deprecated baseLayout", () => {
    const out = renderTemplate(
      "notification",
      { title: "Welcome to Thrivo", body: "Let's hit your goals." },
      {
        recipientEmail: "maya@example.com",
        unsubscribeUrl: "https://thrivo.fit/unsubscribe?email=maya%40example.com",
      }
    );
    expect(out.html).toContain("Sent to maya@example.com");
    expect(out.html).toContain("https://thrivo.fit/unsubscribe?email=maya%40example.com");
    expect(out.html).toContain("@media (prefers-color-scheme: dark)");
  });

  it("throws on an unknown template name", () => {
    // Cast through unknown — runtime callers (worker payloads) aren't type-checked.
    expect(() => renderTemplate("nope" as unknown as "notification", {} as never)).toThrow(
      /unknown email template/
    );
  });
});
