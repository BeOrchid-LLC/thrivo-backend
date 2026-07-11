/**
 * R4-3 — one-time backfill for I11 (ADR-0023's sibling decision, R4 doc D2).
 *
 * `upsertStreak` had no production caller until this phase, so every existing
 * user's `streaks` row is either missing or stuck at its default 0. This
 * derives each user's real current/longest streak from `daily_summaries`
 * (D2: a summary row only exists because a real food-log write triggered
 * `refreshDailySummary`, so it's exactly the "did they log on local day D?"
 * signal the live write-path now uses too) and upserts the result — the same
 * pure fold (`foldStreakFromLocalDates`) the live event-driven path is built
 * on, so backfilled and live-computed streaks can't disagree by construction.
 *
 * Dry-run by default. Nothing is written unless --apply is passed. Checkpointed
 * by `users.id` (keyset, never offset — SYSTEM_DESIGN §373) so a crash/interrupt
 * resumes instead of restarting.
 *
 * Checkpoint/report files default to the OS temp dir (see backfill-food-basis.ts
 * for why: /app is root-owned in the deployed container, the `node` user can't
 * write there). Override with --checkpoint-dir= for cross-restart durability.
 *
 * Usage:
 *   tsx scripts/backfill-streaks.ts [--apply] [--batch-size=200]
 *                                    [--max-batches=N] [--reset]
 *                                    [--checkpoint-dir=path] [--report-out=path.json]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeDb, db } from "../db";
import { logger } from "../src/lib/logger";
import { dailySummaryRepo, streakRepo } from "../src/repositories";
import { foldStreakFromLocalDates } from "../src/services/streak.service";

const DEFAULT_CHECKPOINT_DIR = path.join(os.tmpdir(), "thrivo-backfill-streaks");

interface Checkpoint {
  lastUserId: string | null;
  processedUsers: number;
  touchedUsers: number;
  startedAt: string;
  updatedAt: string;
}

function freshCheckpoint(): Checkpoint {
  const now = new Date().toISOString();
  return { lastUserId: null, processedUsers: 0, touchedUsers: 0, startedAt: now, updatedAt: now };
}

async function loadCheckpoint(checkpointPath: string, reset: boolean): Promise<Checkpoint> {
  if (!reset) {
    try {
      const raw = await readFile(checkpointPath, "utf8");
      return JSON.parse(raw) as Checkpoint;
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
  batchSize: number;
  maxBatches: number | null;
  reset: boolean;
  reportOut: string | null;
  checkpointDir: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    batchSize: 200,
    maxBatches: null,
    reset: false,
    reportOut: null,
    checkpointDir: null,
  };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--reset") args.reset = true;
    else if (raw.startsWith("--batch-size=")) args.batchSize = Number(raw.split("=")[1]);
    else if (raw.startsWith("--max-batches=")) args.maxBatches = Number(raw.split("=")[1]);
    else if (raw.startsWith("--report-out=")) args.reportOut = raw.split("=")[1];
    else if (raw.startsWith("--checkpoint-dir=")) args.checkpointDir = raw.split("=")[1];
  }
  return args;
}

async function processUser(userId: string, args: Args, checkpoint: Checkpoint): Promise<void> {
  const localDates = await dailySummaryRepo.listLocalDatesForUser(userId);
  const next = foldStreakFromLocalDates(localDates);
  const existing = await streakRepo.getByUser(userId);

  const unchanged =
    existing &&
    existing.currentStreak === next.currentStreak &&
    existing.longestStreak === next.longestStreak &&
    existing.lastLoggedDate === next.lastLoggedDate;
  if (unchanged) return;

  checkpoint.touchedUsers += 1;
  logger.info(
    {
      userId,
      from: existing
        ? {
            currentStreak: existing.currentStreak,
            longestStreak: existing.longestStreak,
            lastLoggedDate: existing.lastLoggedDate,
          }
        : null,
      to: next,
    },
    "backfill: streak correction found"
  );
  if (!args.apply) return; // dry-run: report the diff, write nothing

  await db.transaction(async (tx) => {
    await streakRepo.lockForUser(userId, tx);
    await streakRepo.upsertStreak(
      {
        userId,
        currentStreak: next.currentStreak,
        longestStreak: next.longestStreak,
        lastLoggedDate: next.lastLoggedDate,
      },
      tx
    );
  });
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const checkpointDir = args.checkpointDir ?? DEFAULT_CHECKPOINT_DIR;
  const checkpointPath = path.join(checkpointDir, "streaks-backfill.json");
  const checkpoint = await loadCheckpoint(checkpointPath, args.reset);
  logger.info(
    {
      apply: args.apply,
      batchSize: args.batchSize,
      resumingFrom: checkpoint.lastUserId,
      checkpointDir,
    },
    `backfill: starting (${args.apply ? "APPLY" : "DRY RUN"})`
  );

  let batches = 0;
  for (;;) {
    if (args.maxBatches !== null && batches >= args.maxBatches) {
      logger.info({ batches }, "backfill: max-batches reached, stopping (resumable)");
      break;
    }
    const userIds = await dailySummaryRepo.listUserIdsWithSummariesAfter(
      checkpoint.lastUserId,
      args.batchSize
    );
    if (userIds.length === 0) break;

    for (const userId of userIds) {
      await processUser(userId, args, checkpoint);
      checkpoint.processedUsers += 1;
      checkpoint.lastUserId = userId;
    }
    await saveCheckpoint(checkpointPath, checkpoint);
    batches += 1;
    logger.info(
      { processed: checkpoint.processedUsers, touched: checkpoint.touchedUsers },
      "backfill: batch complete"
    );
  }

  const reportPath = args.reportOut ?? path.join(checkpointDir, "streaks-backfill-report.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(checkpoint, null, 2));
  logger.info({ reportPath, apply: args.apply }, "backfill: run complete");
}

run()
  .then(closeDb)
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, "backfill: failed (progress is checkpointed — re-run to resume)");
    await closeDb();
    process.exit(1);
  });
