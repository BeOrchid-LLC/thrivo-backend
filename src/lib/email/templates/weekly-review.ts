import type { EmailTemplate } from "../types";
import { emailBrand, emailTokens } from "../tokens";
import {
  emailButton,
  emailDivider,
  emailFooter,
  emailHeader,
  emailProgressRing,
  emailRowList,
  emailSecondaryCard,
  emailShell,
  escapeHtml,
} from "./base";

/** Daily "you haven't logged yet today" nudge, framed around the trailing 7-day count. */
export type WeeklyReviewProps = {
  /** Distinct days logged in the rolling 7-day window ending yesterday (0-7) — see weekly-review.service. */
  loggedThisWeek: number;
  /** Distinct days logged in the 7-day window before that (0-7). */
  loggedLastWeek: number;
};

const HEADING = "Keep the momentum going.";
const PARAGRAPH =
  "Log today before it gets busy - your streak and weekly number depend on it. One entry is a good place to start.";
const NUDGE_NOTE =
  "You'll get this nudge every day you haven't logged. Weekends included — consistency is the point.";
const OPT_OUT_NOTE =
  "If you'd rather not get these, you can adjust your notification preferences in the app.";

export const weeklyReviewTemplate: EmailTemplate<WeeklyReviewProps> = {
  subject: () => "Your week in review",
  render: (p, ctx) => {
    const thisWeek = Math.max(0, Math.min(7, Math.round(p.loggedThisWeek)));
    const lastWeek = Math.max(0, Math.min(7, Math.round(p.loggedLastWeek)));
    const percent = Math.round((thisWeek / 7) * 100);
    const lastWeekLine = `Last week: ${lastWeek} of 7. You're building something real — this is exactly how it's supposed to go.`;

    // Top zone follows the theme (white card / dark card). The bottom CTA zone
    // is a contrast device that's light-mode-only: a fixed dark navy panel
    // against the white top zone. Confirmed by the dark frame (277:352) that
    // in dark mode it doesn't stand out at all — no background override there,
    // so ctaPanelBg/ctaPanelText just fall back to the card's own colors.
    const cardHtml = `
      <div style="padding:28px 24px 24px;text-align:center;">
        ${emailProgressRing({ percent, line1: "You logged", line2: `${thisWeek} of 7 days` })}
        <p class="email-soft-muted" style="margin:18px 0 0;font-size:14px;line-height:1.5;color:${emailTokens.light.softMutedText};">${escapeHtml(
          lastWeekLine
        )}</p>
      </div>
      ${emailDivider()}
      <div class="email-cta-panel-bg" style="background:${emailTokens.light.ctaPanelBg};padding:22px 24px 24px;">
        <p class="email-cta-panel-text" style="margin:0;font-size:16px;font-weight:700;line-height:1.3;letter-spacing:-0.2px;color:${emailTokens.light.ctaPanelText};">${escapeHtml(
          HEADING
        )}</p>
        <p class="email-cta-panel-text" style="margin:8px 0 0;font-size:14px;line-height:1.55;color:${emailTokens.light.ctaPanelText};">${escapeHtml(PARAGRAPH)}</p>
        <div style="padding-top:20px;">${emailButton({
          label: "Log today's meals",
          url: "https://thrivo.fit/app/log",
          icon: "fork",
          trailingIcon: "arrow-right",
        })}</div>
        <p style="margin:10px 0 0;font-size:12px;font-weight:500;text-align:center;color:${emailBrand.ctaPanelCaption};">Takes less than 2 minutes</p>
      </div>`;

    const infoCardHtml = emailSecondaryCard(
      emailRowList([
        { icon: "check-circle", text: NUDGE_NOTE, muted: true },
        { icon: "warning", text: OPT_OUT_NOTE, muted: true },
      ])
    );

    const html = emailShell({
      headerHtml: emailHeader({ eyebrow: "Your week in review", eyebrowIcon: "trending" }),
      cardHtml,
      footerHtml:
        infoCardHtml +
        emailFooter({ recipientEmail: ctx.recipientEmail, unsubscribeUrl: ctx.unsubscribeUrl }),
    });

    const text = `${HEADING}\n\nYou logged ${thisWeek} of 7 days this week. ${lastWeekLine}\n\n${PARAGRAPH}\n\nLog today's meals: https://thrivo.fit/app/log\n\n${NUDGE_NOTE}\n${OPT_OUT_NOTE}`;
    return { html, text };
  },
};
