/**
 * One-off backfill for `subscription_events.priceAmountCents`/`currency` — so
 * the admin user-detail page's "revenue to date"/"first charge" aren't blank
 * for events recorded before price parsing was added to
 * billing-webhook.service.ts. Mines the raw payload already sitting in
 * `webhook_events.payload` (joined via `subscription_events.raw_event_id`)
 * for RevenueCat's `price_in_purchased_currency`/`currency` fields.
 *
 * Best-effort: rows whose stored payload genuinely has no price field are
 * SKIPPED, never zero-filled — the same "don't fabricate a day/event you
 * have no data for" principle as backfill-mrr-snapshots.ts.
 *
 * Dry-run by default. Nothing is written unless --apply is passed. Never
 * overwrites a row that already has a non-null priceAmountCents unless
 * --force is passed. Checkpointed by the last-processed subscription_events
 * id (uuid keyset) so a crash/interrupt resumes instead of restarting.
 *
 * Usage:
 *   tsx scripts/backfill-subscription-event-prices.ts [--apply] [--force]
 *                                                       [--batch-size=500]
 *                                                       [--reset] [--checkpoint-dir=path]
 *                                                       [--report-out=path.json]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { closeDb, db } from "../db";
import { subscriptionEvents, webhookEvents } from "../db/schema";
import { logger } from "../src/lib/logger";
import { subscriptionEventRepo } from "../src/repositories";

const DEFAULT_CHECKPOINT_DIR = path.join(os.tmpdir(), "thrivo-backfill-subscription-event-prices");

interface Checkpoint {
  lastId: string | null;
  scanned: number;
  updated: number;
  skippedNoPriceData: number;
  skippedAlreadyPriced: number;
  startedAt: string;
  updatedAt: string;
}

function freshCheckpoint(): Checkpoint {
  const now = new Date().toISOString();
  return {
    lastId: null,
    scanned: 0,
    updated: 0,
    skippedNoPriceData: 0,
    skippedAlreadyPriced: 0,
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
  force: boolean;
  batchSize: number;
  reset: boolean;
  reportOut: string | null;
  checkpointDir: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    force: false,
    batchSize: 500,
    reset: false,
    reportOut: null,
    checkpointDir: null,
  };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--force") args.force = true;
    else if (raw === "--reset") args.reset = true;
    else if (raw.startsWith("--batch-size=")) args.batchSize = Number(raw.split("=")[1]);
    else if (raw.startsWith("--report-out=")) args.reportOut = raw.split("=")[1];
    else if (raw.startsWith("--checkpoint-dir=")) args.checkpointDir = raw.split("=")[1];
  }
  return args;
}

interface BatchRow {
  eventId: string;
  existingPriceAmountCents: number | null;
  payload: unknown;
}

/** A page of subscription_events joined to their raw webhook payload, oldest
 *  id first. `force` includes already-priced rows (so a correction re-run can
 *  overwrite them); otherwise only unpriced rows are considered. */
async function loadBatch(
  afterId: string | null,
  limit: number,
  force: boolean
): Promise<BatchRow[]> {
  const rows = await db
    .select({
      eventId: subscriptionEvents.id,
      existingPriceAmountCents: subscriptionEvents.priceAmountCents,
      payload: webhookEvents.payload,
    })
    .from(subscriptionEvents)
    .innerJoin(webhookEvents, eq(subscriptionEvents.rawEventId, webhookEvents.id))
    .where(
      and(
        force ? undefined : isNull(subscriptionEvents.priceAmountCents),
        afterId ? gt(subscriptionEvents.id, afterId) : undefined
      )
    )
    .orderBy(asc(subscriptionEvents.id))
    .limit(limit);
  return rows;
}

/** Same defensive extraction style as backfill-mrr-snapshots.ts::loadTimeline —
 *  never trust the jsonb blob's shape. Returns null when no usable price field
 *  is present (never fabricates a 0). */
function extractPrice(payload: unknown): { cents: number; currency: string | null } | null {
  const event = (payload as { event?: Record<string, unknown> })?.event;
  const raw = event?.price_in_purchased_currency;
  if (typeof raw !== "number") return null;
  const currency = typeof event?.currency === "string" ? event.currency : null;
  return { cents: Math.round(raw * 100), currency };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const checkpointDir = args.checkpointDir ?? DEFAULT_CHECKPOINT_DIR;
  // Separate files per mode — a completed dry run must never let the very
  // next --apply silently resume-and-no-op from the dry run's end cursor.
  const checkpointPath = path.join(
    checkpointDir,
    `subscription-event-prices-backfill-${args.apply ? "apply" : "dryrun"}.json`
  );
  const checkpoint = await loadCheckpoint(checkpointPath, args.reset);
  logger.info(
    { apply: args.apply, force: args.force, resumingFrom: checkpoint.lastId, checkpointDir },
    `backfill: starting (${args.apply ? "APPLY" : "DRY RUN"})`
  );

  for (;;) {
    const batch = await loadBatch(checkpoint.lastId, args.batchSize, args.force);
    if (batch.length === 0) break;

    for (const row of batch) {
      checkpoint.scanned += 1;
      checkpoint.lastId = row.eventId;

      if (row.existingPriceAmountCents !== null && !args.force) {
        checkpoint.skippedAlreadyPriced += 1;
        continue;
      }

      const price = extractPrice(row.payload);
      if (!price) {
        checkpoint.skippedNoPriceData += 1;
        continue;
      }

      logger.info(
        { eventId: row.eventId, cents: price.cents, currency: price.currency },
        "backfill: price reconstructed"
      );
      if (args.apply) {
        await subscriptionEventRepo.updatePrice(row.eventId, price.cents, price.currency);
      }
      checkpoint.updated += 1;
    }

    await saveCheckpoint(checkpointPath, checkpoint);
    logger.info(
      { scanned: checkpoint.scanned, updated: checkpoint.updated },
      "backfill: batch complete"
    );
  }

  const reportPath =
    args.reportOut ??
    path.join(
      checkpointDir,
      `subscription-event-prices-backfill-report-${args.apply ? "apply" : "dryrun"}.json`
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
