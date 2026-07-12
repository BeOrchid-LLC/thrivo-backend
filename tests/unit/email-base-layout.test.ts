import { describe, expect, it } from "vitest";
import {
  emailButton,
  emailDivider,
  emailFallbackLinkCard,
  emailFooter,
  emailHeader,
  emailIconBadge,
  emailIconRow,
  emailShell,
} from "../../src/lib/email/templates/base";

describe("email base layout", () => {
  it("wraps content in a shell with dark-mode support wired up", () => {
    const html = emailShell({
      headerHtml: "<p>header</p>",
      cardHtml: "<p>card</p>",
      footerHtml: "<p>footer</p>",
    });
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("!important");
    expect(html).toContain("<p>header</p>");
    expect(html).toContain("<p>card</p>");
    expect(html).toContain("<p>footer</p>");
  });

  it("renders a full-bleed divider rule", () => {
    expect(emailDivider()).toContain("email-border");
  });

  it("centers the header when there is no eyebrow badge", () => {
    const html = emailHeader();
    expect(html).toContain("THRIVO");
    expect(html).toContain('align="center"');
    expect(html).not.toContain('align="right"');
  });

  it("renders a left/right split header with an escaped eyebrow badge", () => {
    const html = emailHeader({ eyebrow: "<b>Your week in review</b>" });
    expect(html).toContain('align="right"');
    expect(html).toContain("&lt;b&gt;Your week in review&lt;/b&gt;");
    expect(html).not.toContain("<b>Your week in review</b>");
  });

  it("renders a recognizable icon badge for each variant", () => {
    expect(emailIconBadge("seal-check")).toContain("<svg");
    expect(emailIconBadge("envelope")).toContain("<svg");
  });

  it("renders an icon row with escaped text", () => {
    const html = emailIconRow({ icon: "clock", text: "<script>alert(1)</script>" });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("renders the footer with recipient, year, and an unsubscribe link", () => {
    const html = emailFooter({
      recipientEmail: "maya@example.com",
      unsubscribeUrl: "https://thrivo.fit/unsubscribe?token=abc",
    });
    expect(html).toContain("Sent to maya@example.com");
    expect(html).toContain(String(new Date().getFullYear()));
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("https://thrivo.fit/unsubscribe?token=abc");
  });

  it("renders a CTA button with an escaped url and optional icon", () => {
    const html = emailButton({
      label: "Sign in",
      url: "https://thrivo.fit/x?a=1&b=2",
      icon: "link",
    });
    expect(html).toContain("Sign in");
    expect(html).toContain("https://thrivo.fit/x?a=1&amp;b=2");
    expect(html).toContain("<svg");
  });

  it("renders the fallback link card with an escaped url", () => {
    const html = emailFallbackLinkCard({ url: "https://thrivo.fit/x?a=1&b=2" });
    expect(html).toContain("Having trouble?");
    expect(html).toContain("https://thrivo.fit/x?a=1&amp;b=2");
  });
});
