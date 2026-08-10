import type { EmailTemplate } from "../types";
import { emailTokens } from "../tokens";
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

/** Completed Sunday-Saturday food-logging review. */
export type WeeklyReviewProps = {
  periodStart: string;
  periodEnd: string;
  loggedDays: number;
  previousLoggedDays: number;
  includeComparison: boolean;
  joinedDuringPeriod: boolean;
  progressUrl: string;
};

const HEADING = "Your week in Thrivo";
const OPT_OUT_NOTE =
  "You can turn weekly review emails off or back on from notification settings in the app.";

function formatPeriodDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export const weeklyReviewTemplate: EmailTemplate<WeeklyReviewProps> = {
  subject: (p) => `Your Thrivo week: ${p.loggedDays} of 7 days logged`,
  render: (p, ctx) => {
    const thisWeek = Math.max(0, Math.min(7, Math.round(p.loggedDays)));
    const lastWeek = Math.max(0, Math.min(7, Math.round(p.previousLoggedDays)));
    const percent = Math.round((thisWeek / 7) * 100);
    const range = `${formatPeriodDate(p.periodStart)} – ${formatPeriodDate(p.periodEnd)}`;
    const comparison =
      thisWeek === lastWeek
        ? `That is the same as the previous week: ${lastWeek} days.`
        : thisWeek > lastWeek
          ? `That is ${thisWeek - lastWeek} more day${thisWeek - lastWeek === 1 ? "" : "s"} than the previous week.`
          : `That is ${lastWeek - thisWeek} fewer day${lastWeek - thisWeek === 1 ? "" : "s"} than the previous week.`;
    const summary = p.joinedDuringPeriod
      ? `You joined partway through this week and logged food on ${thisWeek} day${thisWeek === 1 ? "" : "s"}.`
      : `You logged food on ${thisWeek} of 7 days.`;

    // Top zone follows the theme (white card / dark card). The bottom CTA zone
    // is a contrast device that's light-mode-only: a fixed dark navy panel
    // against the white top zone. Confirmed by the dark frame (277:352) that
    // in dark mode it doesn't stand out at all — no background override there,
    // so ctaPanelBg/ctaPanelText just fall back to the card's own colors.
    const cardHtml = `
      <div style="padding:28px 24px 24px;text-align:center;">
        ${emailProgressRing({ percent, line1: "You logged", line2: `${thisWeek} of 7 days` })}
        <p class="email-soft-muted" style="margin:18px 0 0;font-size:14px;line-height:1.5;color:${emailTokens.light.softMutedText};">${escapeHtml(
          range
        )}</p>
      </div>
      ${emailDivider()}
      <div class="email-cta-panel-bg" style="background:${emailTokens.light.ctaPanelBg};padding:22px 24px 24px;">
        <p class="email-cta-panel-text" style="margin:0;font-size:16px;font-weight:700;line-height:1.3;letter-spacing:-0.2px;color:${emailTokens.light.ctaPanelText};">${escapeHtml(
          summary
        )}</p>
        ${p.includeComparison ? `<p class="email-cta-panel-text" style="margin:8px 0 0;font-size:14px;line-height:1.55;color:${emailTokens.light.ctaPanelText};">${escapeHtml(comparison)}</p>` : ""}
        <div style="padding-top:20px;">${emailButton({
          label: "View your progress",
          url: p.progressUrl,
          trailingIcon: "arrow-right",
        })}</div>
      </div>`;

    const infoCardHtml = emailSecondaryCard(
      emailRowList([
        { icon: "check-circle", text: `Reviewed period: ${range}.`, muted: true },
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

    const text = `${HEADING}\n\n${range}\n${summary}${p.includeComparison ? ` ${comparison}` : ""}\n\nView your progress: ${p.progressUrl}\n\n${OPT_OUT_NOTE}`;
    return { html, text };
  },
};
