import { describe, expect, it } from "vitest";
import {
  emailButton,
  emailDivider,
  emailFallbackLinkCard,
  emailFooter,
  emailHeader,
  emailHeroText,
  emailIconBadge,
  emailIconRow,
  emailProgressRing,
  emailRowList,
  emailSecondaryCard,
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
    expect(html).toContain('src="https://static.thrivo.fit/logo.png"');
    expect(html).not.toContain('src="cid:thrivo-logo"');
    expect(html).toContain('align="center"');
    expect(html).not.toContain('align="right"');
  });

  it("renders a left/right split header with an escaped eyebrow badge", () => {
    const html = emailHeader({ eyebrow: "<b>Your week in review</b>" });
    expect(html).toContain('align="right"');
    expect(html).toContain("&lt;b&gt;Your week in review&lt;/b&gt;");
    expect(html).not.toContain("<b>Your week in review</b>");
  });

  it("renders accessible raster-safe icon badges without inline SVG", () => {
    expect(emailIconBadge("seal-check")).toContain('aria-label="Verified"');
    expect(emailIconBadge("envelope")).toContain('aria-label="Email"');
    expect(emailIconBadge("seal-check")).not.toContain("<svg");
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
    expect(html).toContain("↗");
    expect(html).not.toContain("<svg");
  });

  it("renders the fallback link card with an escaped url", () => {
    const html = emailFallbackLinkCard({ url: "https://thrivo.fit/x?a=1&b=2" });
    expect(html).toContain("Having trouble?");
    expect(html).toContain("https://thrivo.fit/x?a=1&amp;b=2");
  });

  it("renders the progress ring with the rounded percent and escaped caption lines", () => {
    const html = emailProgressRing({
      percent: 57.4,
      line1: "You logged",
      line2: "<b>4</b> of 7 days",
    });
    expect(html).toContain(">57%<");
    expect(html).toContain("You logged");
    expect(html).toContain("&lt;b&gt;4&lt;/b&gt; of 7 days");
    expect(html).not.toContain("<b>4</b> of 7 days");
  });

  it("clamps the progress ring to 0-100", () => {
    expect(emailProgressRing({ percent: 140 })).toContain(">100%<");
    expect(emailProgressRing({ percent: -20 })).toContain(">0%<");
  });

  it("renders a heading + escaped paragraph with configurable top margins", () => {
    const html = emailHeroText({
      heading: "Here's your sign-in link",
      paragraph: "<b>No</b> password needed.",
      headingMarginTop: 12,
      paragraphMarginTop: 12,
    });
    expect(html).toContain("margin:12px 0 0");
    expect(html).toContain("Here&#39;s your sign-in link");
    expect(html).toContain("&lt;b&gt;No&lt;/b&gt; password needed.");
  });

  it("omits the paragraph entirely when none is given", () => {
    const html = emailHeroText({ heading: "Reset your password" });
    expect(html).toContain("Reset your password");
    expect(html).not.toContain("<p");
  });

  it("interleaves exactly one divider between each row, none at the ends", () => {
    const html = emailRowList([
      { icon: "clock", text: "a" },
      { icon: "check", text: "b" },
      { icon: "shield", text: "c" },
    ]);
    const dividerCount = html.split('class="email-border"').length - 1;
    expect(dividerCount).toBe(2); // 3 rows → 2 gaps, not 3
  });

  it("wraps arbitrary content in the secondary-card treatment", () => {
    const html = emailSecondaryCard("<p>inner</p>");
    expect(html).toContain("email-card");
    expect(html).toContain("<p>inner</p>");
  });
});
