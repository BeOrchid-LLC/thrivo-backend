import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { citext, idPk } from "./_shared";
import { users } from "./users";

/**
 * Pre-signup leads — no user FK at capture time; reconciled to a user by email
 * on signup. Resubmissions from the same email upsert in place (same id,
 * original capturedAt survives): metadata refreshes, submissionCount
 * increments, lastSubmittedAt updates. See email-capture.repository.ts.
 */
export const emailCaptures = pgTable(
  "email_captures",
  {
    id: idPk(),
    email: citext("email").notNull().unique(),
    source: text("source"), // 'cta', 'landing', 'waitlist', ...
    reconciledUserId: uuid("reconciled_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),

    // Resubmission tracking.
    submissionCount: integer("submission_count").notNull().default(1),
    lastSubmittedAt: timestamp("last_submitted_at", { withTimezone: true }).notNull().defaultNow(),

    // Request-derived marketing metadata -- no browser permission needed for any of this.
    country: text("country"), // from Cloudflare's cf-ipcountry edge header
    deviceType: text("device_type"), // 'mobile' | 'tablet' | 'desktop'
    osName: text("os_name"),
    osVersion: text("os_version"),
    browserName: text("browser_name"),
    browserVersion: text("browser_version"),
    rawUserAgent: text("raw_user_agent"), // capped at insert time; ua-parser-js is heuristic
    referrer: text("referrer"), // capped at insert time
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
  },
  (t) => ({
    // Backs the admin leads list's keyset pagination (R5-4/I16) — ORDER BY
    // (captured_at desc, id desc) with a `(captured_at, id) < cursor` seek.
    capturedAtIdx: index("email_captures_captured_at_id_idx").on(t.capturedAt, t.id),
  })
);

export type EmailCaptureRow = typeof emailCaptures.$inferSelect;
export type NewEmailCaptureRow = typeof emailCaptures.$inferInsert;
