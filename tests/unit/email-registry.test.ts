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

  it("renders the otp template's recipient and expiry into the footer/body via render context", () => {
    const out = renderTemplate(
      "otp",
      { code: "123456", purpose: "email-verification", expiresInMinutes: 5 },
      {
        recipientEmail: "maya@example.com",
        unsubscribeUrl: "https://thrivo.fit/unsubscribe?email=maya%40example.com",
      }
    );
    expect(out.html).toContain("Sent to maya@example.com");
    expect(out.html).toContain("https://thrivo.fit/unsubscribe?email=maya%40example.com");
    expect(out.html).toContain("expires in 5 minutes");
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
  });

  it("escapes HTML in props to prevent markup injection", () => {
    const out = renderTemplate("notification", {
      title: "<script>alert(1)</script>",
      body: "plain",
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("throws on an unknown template name", () => {
    // Cast through unknown — runtime callers (worker payloads) aren't type-checked.
    expect(() => renderTemplate("nope" as unknown as "notification", {} as never)).toThrow(
      /unknown email template/
    );
  });
});
