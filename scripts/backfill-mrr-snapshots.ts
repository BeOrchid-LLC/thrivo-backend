/**
 * B2a — one-off backfill for `mrr_snapshots`, so the admin overview's revenue
 * trend chart isn't empty on launch. `mrr_snapshots` is only ever written
 * going forward by the nightly snapshot-mrr job; this reconstructs the days
 * *before* that job existed by replaying every processed RevenueCat
 * `webhook_events` row through the same `mapStatus` logic the live webhook
 * handler uses — backfilled and live-computed days can't disagree by
 * construction.
 *
 * Best-effort: if webhook history doesn't reach back `--days`, the trend
 * simply starts wherever real events exist. This script never fabricates a
 * day it has no events for — an all-zero reconstruction for a day before any
 * webhook was ever received is still the mathematically correct "no
 * subscribers yet" state, not a guess.
 *
 * Dry-run by default. Nothing is written unless --apply is passed. Never
 * overwrites a day that already has a real snapshot (the live cron owns
 * those) unless --force is passed. Checkpointed by the last backfilled date
 * so a crash/interrupt resumes instead of restarting — pass the same --days
 * on every run of a given backfill, or the resumed window will shift.
 *
 * Usage:
 *   tsx scripts/backfill-mrr-snapshots.ts [--apply] [--days=180] [--force]
 *                                          [--reset] [--checkpoint-dir=path]
 *                                          [--report-out=path.json]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { closeDb, db } from "../db";
import { webhookEvents, type SubStatus } from "../db/schema";
import { logger } from "../src/lib/logger";
import { mrrSnapshotRepo, userRepo } from "../src/repositories";
import { mapStatus } from "../src/services/billing-webhook.service";
import { PLAN_PRICE_CENTS, subscriptionPlans } from "../src/services/subscription.service";

const DEFAULT_CHECKPOINT_DIR = path.join(os.tmpdir(), "thrivo-backfill-mrr-snapshots");
const ANNUAL_MONTHLY_EQUIV_CENTS = Math.round(PLAN_PRICE_CENTS.annual / 12);

interface Checkpoint {
  lastDate: string | null;
  processedDays: number;
  writtenDays: number;
  skippedExisting: number;
  startedAt: string;
  updatedAt: string;
}

function freshCheckpoint(): Checkpoint {
  const now = new Date().toISOString();
  return {
    lastDate: null,
    processedDays: 0,
    writtenDays: 0,
    skippedExisting: 0,
    startedAt: now,
    updatedAt: now,
  };
}

async function loadCheckpoint(checkpointPath: string, reset: boolean): Promise<Checkpoint> {
  if (!reset) {
    try {
      return JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
    } catch {
      // No checkpoint yet — start fresh.
    }
  }
  return freshCheckpoint();
}

async function saveCheckpoint(checkpointPath: string, checkpoint: Checkpoint): Promise<void> {
  checkpoint.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
}

interface Args {
  apply: boolean;
  days: number;
  force: boolean;
  reset: boolean;
  reportOut: string | null;
  checkpointDir: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    days: 180,
    force: false,
    reset: false,
    reportOut: null,
    checkpointDir: null,
  };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--force") args.force = true;
    else if (raw === "--reset") args.reset = true;
    else if (raw.startsWith("--days=")) args.days = Number(raw.split("=")[1]);
    else if (raw.startsWith("--report-out=")) args.reportOut = raw.split("=")[1];
    else if (raw.startsWith("--checkpoint-dir=")) args.checkpointDir = raw.split("=")[1];
  }
  return args;
}

interface TimelineEvent {
  userId: string;
  type: string;
  productId: string | null;
  periodType: string | null;
  occurredAt: Date;
}

interface UserState {
  status: SubStatus | null;
  productId: string | null;
  lastEventAt: Date | null;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function endOfUtcDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

/** Every processed RevenueCat event, oldest first — same raw envelope shape
 *  the live webhook handler validates before storing it. */
async function loadTimeline(): Promise<TimelineEvent[]> {
  const rows = await db
    .select({ payload: webhookEvents.payload, receivedAt: webhookEvents.receivedAt })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.provider, "revenuecat"), eq(webhookEvents.status, "processed")))
    .orderBy(asc(webhookEvents.receivedAt));

  const events: TimelineEvent[] = [];
  for (const row of rows) {
    const payload = row.payload as { event?: Record<string, unknown> };
    const e = payload.event;
    if (!e || typeof e.app_user_id !== "string" || typeof e.type !== "string") continue;
    const occurredAt =
      typeof e.event_timestamp_ms === "number" ? new Date(e.event_timestamp_ms) : row.receivedAt;
    events.push({
      userId: e.app_user_id,
      type: e.type,
      productId: typeof e.product_id === "string" ? e.product_id : null,
      periodType: typeof e.period_type === "string" ? e.period_type : null,
      occurredAt,
    });
  }
  events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return events;
}

/** Mirrors `subscriptionRepo.upsertFromWebhook`'s monotonic guard. Returns
 *  true only on a fresh transition into `expired` (for that day's churn). */
function applyEvent(state: Map<string, UserState>, event: TimelineEvent): boolean {
  const status = mapStatus(event.type, event.periodType);
  if (!status) return false;
  const current = state.get(event.userId);
  if (current?.lastEventAt && current.lastEventAt >= event.occurredAt) return false;
  const previousStatus = current?.status ?? null;
  state.set(event.userId, { status, productId: event.productId, lastEventAt: event.occurredAt });
  return previousStatus !== "expired" && status === "expired";
}

function countByPlan(state: Map<string, UserState>): { monthly: number; annual: number } {
  let monthly = 0;
  let annual = 0;
  for (const s of state.values()) {
    if (!["active", "in_grace", "past_due"].includes(s.status ?? "")) continue;
    if (s.productId === subscriptionPlans.monthly.productId) monthly += 1;
    else if (s.productId === subscriptionPlans.annual.productId) annual += 1;
  }
  return { monthly, annual };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const checkpointDir = args.checkpointDir ?? DEFAULT_CHECKPOINT_DIR;
  // Separate files per mode — see backfill-streaks.ts: a shared cursor would
  // let a completed dry run silently no-op the very next --apply.
  const checkpointPath = path.join(
    checkpointDir,
    `mrr-snapshots-backfill-${args.apply ? "apply" : "dryrun"}.json`
  );
  const checkpoint = await loadCheckpoint(checkpointPath, args.reset);
  logger.info(
    { apply: args.apply, days: args.days, resumingFrom: checkpoint.lastDate, checkpointDir },
    `backfill: starting (${args.apply ? "APPLY" : "DRY RUN"})`
  );

  const timeline = await loadTimeline();
  if (timeline.length === 0) {
    logger.warn("backfill: no processed revenuecat webhook_events found — nothing to reconstruct");
  }

  const totalUsers = await userRepo.countActive();
  const now = new Date();
  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - (args.days - 1));
  const resumeFrom = checkpoint.lastDate
    ? new Date(`${checkpoint.lastDate}T00:00:00.000Z`)
    : startDate;

  const state = new Map<string, UserState>();
  let eventIdx = 0;

  for (
    const cursor = new Date(startDate);
    cursor <= now;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const dateStr = toDateOnly(cursor);
    const dayEnd = endOfUtcDay(dateStr);

    const expiredToday = new Set<string>();
    while (eventIdx < timeline.length && timeline[eventIdx].occurredAt <= dayEnd) {
      const flippedToExpired = applyEvent(state, timeline[eventIdx]);
      if (flippedToExpired) expiredToday.add(timeline[eventIdx].userId);
      eventIdx += 1;
    }

    if (cursor < resumeFrom) {
      checkpoint.processedDays += 1;
      continue; // state replayed for consistency, but this day was already backfilled
    }

    const { monthly, annual } = countByPlan(state);
    const mrrCents = monthly * PLAN_PRICE_CENTS.monthly + annual * ANNUAL_MONTHLY_EQUIV_CENTS;
    const premiumUserCount = monthly + annual;
    let churnedMrrCents = 0;
    for (const userId of expiredToday) {
      const s = state.get(userId);
      if (s?.productId === subscriptionPlans.monthly.productId) {
        churnedMrrCents += PLAN_PRICE_CENTS.monthly;
      } else if (s?.productId === subscriptionPlans.annual.productId) {
        churnedMrrCents += ANNUAL_MONTHLY_EQUIV_CENTS;
      }
    }

    const existing = args.force ? null : await mrrSnapshotRepo.getOnOrBefore(dayEnd);
    const alreadyHasThisDay = Boolean(existing && existing.snapshotDate === dateStr);

    if (alreadyHasThisDay) {
      checkpoint.skippedExisting += 1;
    } else {
      logger.info(
        { dateStr, mrrCents, monthly, annual, churnedMrrCents },
        "backfill: day reconstructed"
      );
      if (args.apply) {
        await mrrSnapshotRepo.upsertToday({
          snapshotDate: dateStr,
          mrrCents,
          activeMonthlyCount: monthly,
          activeAnnualCount: annual,
          premiumUserCount,
          // Approximated with today's total, not the count as-of that historical
          // day (no reliable historical user-count source) — cosmetic only.
          freeUserCount: Math.max(totalUsers - premiumUserCount, 0),
          churnedMrrCents,
        });
      }
      checkpoint.writtenDays += 1;
    }

    checkpoint.processedDays += 1;
    checkpoint.lastDate = dateStr;
    await saveCheckpoint(checkpointPath, checkpoint);
  }

  const reportPath =
    args.reportOut ??
    path.join(
      checkpointDir,
      `mrr-snapshots-backfill-report-${args.apply ? "apply" : "dryrun"}.json`
    );
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(checkpoint, null, 2));
  logger.info({ reportPath, apply: args.apply, checkpoint }, "backfill: run complete");
}

run()
  .then(closeDb)
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, "backfill: failed (progress is checkpointed — re-run to resume)");
    await closeDb();
    process.exit(1);
  });
