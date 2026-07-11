/**
 * R1-5 — one-time, resumable backfill for I1/I2 (ADR-0022).
 *
 * Re-derives `food_nutrients.basis` for every active Open-Food-Facts-origin
 * catalog item using the fixed single-basis normalization (R1-2), then
 * recomputes any `food_logs` snapshot that used the old (wrong) numbers, then
 * re-runs `daily_summaries` for every affected (user, day) through the SAME
 * advisory-locked path the live app uses (`food.service.refreshDailySummary`)
 * so a concurrent live writer can't interleave a half-recompute.
 *
 * The original per-serving-vs-per-100g split isn't stored anywhere except the
 * upstream OFF product, so "re-derive" means re-fetching each item by barcode
 * — this is the only source of truth for what changed.
 *
 * Dry-run by default. Nothing is written unless --apply is passed. Checkpointed
 * by `food_items.id` so a crash/interrupt resumes instead of restarting.
 *
 * Checkpoint/report files default to the OS temp dir, not next to the script —
 * the deployed container runs as an unprivileged `node` user while `/app` (the
 * bundled dist/ included) is root-owned from the Docker build, so writing
 * beside the script itself is an EACCES waiting to happen. Override with
 * --checkpoint-dir= to point at a mounted volume for cross-restart durability.
 *
 * Usage:
 *   tsx scripts/backfill-food-basis.ts [--apply] [--batch-size=50]
 *                                       [--max-batches=N] [--reset]
 *                                       [--checkpoint-dir=path] [--report-out=path.json]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeDb, db } from "../db";
import type { FoodItemRow, FoodLogRow, FoodServingRow } from "../db/schema";
import { logger } from "../src/lib/logger";
import { resolveQuantityGrams, scaleNutrients, type NutritionBasis } from "../src/lib/nutrition";
import { fetchOpenFoodFactsProduct } from "../src/integrations/open-food-facts";
import { foodItemRepo, foodLogRepo, userRepo } from "../src/repositories";
import { refreshDailySummary } from "../src/services/food.service";

const DEFAULT_CHECKPOINT_DIR = path.join(os.tmpdir(), "thrivo-backfill-food-basis");
// Conservative pacing against OFF's public, unauthenticated API — this is a
// batch job, not a user-facing request, so there's no latency budget to spend.
const OFF_REQUEST_DELAY_MS = 300;

interface Checkpoint {
  lastFoodItemId: string | null;
  processedItems: number;
  touchedItems: number;
  touchedLogs: number;
  touchedSummaries: number;
  flagged: Array<{ foodItemId: string; barcode: string | null; reason: string }>;
  startedAt: string;
  updatedAt: string;
}

function freshCheckpoint(): Checkpoint {
  const now = new Date().toISOString();
  return {
    lastFoodItemId: null,
    processedItems: 0,
    touchedItems: 0,
    touchedLogs: 0,
    touchedSummaries: 0,
    flagged: [],
    startedAt: now,
    updatedAt: now,
  };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    batchSize: 50,
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

interface NutrientRow {
  basis: string;
  servingLabel: string | null;
  servingG: string | null;
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

/** Whether the fixed normalization would change anything already stored — the entire diff surface. */
function nutrientRowChanged(current: NutrientRow, normalized: NutritionBasis): boolean {
  const EPSILON = 0.01;
  const close = (a: number, b: number) => Math.abs(a - b) < EPSILON;
  if (current.basis !== normalized.basis) return true;
  if (!close(Number(current.servingG ?? 0), normalized.servingG ?? 0)) return true;
  if (!close(Number(current.kcal), normalized.kcal)) return true;
  if (!close(Number(current.proteinG), normalized.proteinG)) return true;
  if (!close(Number(current.carbsG), normalized.carbsG)) return true;
  if (!close(Number(current.fatG), normalized.fatG)) return true;
  return false;
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Recomputes one log's snapshot against the corrected basis. Returns null
 * (leave-and-flag) when the log's serving can't be safely re-derived — e.g. it
 * points at a `servingId` that no longer exists. Never guesses.
 */
function recomputeLog(
  log: FoodLogRow,
  basis: NutritionBasis,
  servings: FoodServingRow[]
): { kcal: number; proteinG: number; carbsG: number; fatG: number } | null {
  try {
    const matched = log.servingId ? servings.find((s) => s.id === log.servingId) : null;
    if (log.servingId && !matched) return null; // stale serving reference — flag, don't guess
    const quantityGrams = resolveQuantityGrams(
      {
        servingId: log.servingId,
        quantity: toNumber(log.servingQty),
        matchedServingGrams: matched ? toNumber(matched.grams) : null,
      },
      basis
    );
    return scaleNutrients(basis, quantityGrams);
  } catch {
    return null;
  }
}

async function processItem(item: FoodItemRow, args: Args, checkpoint: Checkpoint): Promise<void> {
  const barcode = item.barcode ?? item.originRef;
  if (!barcode) {
    checkpoint.flagged.push({ foodItemId: item.id, barcode: null, reason: "no_barcode" });
    return;
  }

  let upstream;
  try {
    upstream = await fetchOpenFoodFactsProduct(barcode);
  } catch (err) {
    checkpoint.flagged.push({
      foodItemId: item.id,
      barcode,
      reason: `off_fetch_error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  if (!upstream) {
    checkpoint.flagged.push({
      foodItemId: item.id,
      barcode,
      reason: "off_product_unavailable_or_incomplete",
    });
    return;
  }

  const current = await foodItemRepo.getNutrients(item.id);
  if (!current) {
    checkpoint.flagged.push({ foodItemId: item.id, barcode, reason: "no_nutrient_row" });
    return;
  }

  const normalized: NutritionBasis = {
    basis: upstream.basis,
    servingG: upstream.basis === "per_serving" ? upstream.servingGrams : null,
    kcal: upstream.nutrients.calories,
    proteinG: upstream.nutrients.proteinG,
    carbsG: upstream.nutrients.carbsG,
    fatG: upstream.nutrients.fatG,
  };

  if (!nutrientRowChanged(current, normalized)) return; // already correct — nothing to touch

  checkpoint.touchedItems += 1;
  logger.info(
    { foodItemId: item.id, barcode, from: current.basis, to: normalized.basis },
    "backfill: basis correction found"
  );
  if (!args.apply) return; // dry-run: report the diff, write nothing

  const affectedDays = new Set<string>(); // `${userId}:${localDate}`

  await db.transaction(async (tx) => {
    await foodItemRepo.upsertNutrients(
      {
        foodItemId: item.id,
        basis: normalized.basis,
        servingLabel: upstream.servingLabel,
        servingG: normalized.servingG !== null ? String(normalized.servingG) : null,
        kcal: String(normalized.kcal),
        proteinG: String(normalized.proteinG),
        carbsG: String(normalized.carbsG),
        fatG: String(normalized.fatG),
        dataCompleteness: current.dataCompleteness,
      },
      tx
    );
    await foodItemRepo.deleteServings(item.id, tx);
    if (upstream.servingGrams) {
      await foodItemRepo.insertServing(
        {
          foodItemId: item.id,
          label: upstream.servingLabel,
          grams: String(upstream.servingGrams),
          isDefault: true,
        },
        tx
      );
    }

    const servings = await foodItemRepo.getServings(item.id, tx);
    const logs = await foodLogRepo.listByFoodItemId(item.id, tx);
    for (const log of logs) {
      const scaled = recomputeLog(log, normalized, servings);
      if (!scaled) {
        checkpoint.flagged.push({
          foodItemId: item.id,
          barcode,
          reason: `log_${log.id}_unresolvable_serving`,
        });
        continue;
      }
      const changed =
        log.kcal !== scaled.kcal ||
        toNumber(log.proteinG) !== scaled.proteinG ||
        toNumber(log.carbsG) !== scaled.carbsG ||
        toNumber(log.fatG) !== scaled.fatG;
      if (!changed) continue;
      await foodLogRepo.updateLog(
        log.id,
        log.loggedAt,
        {
          kcal: scaled.kcal,
          proteinG: String(scaled.proteinG),
          carbsG: String(scaled.carbsG),
          fatG: String(scaled.fatG),
        },
        tx
      );
      checkpoint.touchedLogs += 1;
      affectedDays.add(`${log.userId}:${log.localDate}`);
    }
  });

  for (const key of affectedDays) {
    const [userId, localDate] = key.split(":");
    const user = await userRepo.findById(userId);
    if (!user) continue; // deleted user — nothing to roll up
    await db.transaction(async (tx) => {
      await refreshDailySummary(user, localDate, tx);
    });
    checkpoint.touchedSummaries += 1;
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const checkpointDir = args.checkpointDir ?? DEFAULT_CHECKPOINT_DIR;
  // Separate files per mode: a dry run and an --apply run must never share a
  // cursor. A completed dry run otherwise leaves lastFoodItemId at the end of
  // the table, so the very next --apply "resumes" from there and finds
  // nothing — a silent no-op that looks identical to "already backfilled."
  const checkpointPath = path.join(
    checkpointDir,
    `food-basis-backfill-${args.apply ? "apply" : "dryrun"}.json`
  );
  const checkpoint = await loadCheckpoint(checkpointPath, args.reset);
  logger.info(
    {
      apply: args.apply,
      batchSize: args.batchSize,
      resumingFrom: checkpoint.lastFoodItemId,
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
    const page = await foodItemRepo.listOpenFoodFactsItemsAfter(
      checkpoint.lastFoodItemId,
      args.batchSize
    );
    if (page.length === 0) break;

    for (const item of page) {
      await processItem(item, args, checkpoint);
      checkpoint.processedItems += 1;
      checkpoint.lastFoodItemId = item.id;
      await sleep(OFF_REQUEST_DELAY_MS);
    }
    await saveCheckpoint(checkpointPath, checkpoint);
    batches += 1;
    logger.info(
      {
        processed: checkpoint.processedItems,
        touchedItems: checkpoint.touchedItems,
        touchedLogs: checkpoint.touchedLogs,
        touchedSummaries: checkpoint.touchedSummaries,
        flagged: checkpoint.flagged.length,
      },
      "backfill: batch complete"
    );
  }

  const reportPath =
    args.reportOut ??
    path.join(checkpointDir, `food-basis-backfill-report-${args.apply ? "apply" : "dryrun"}.json`);
  // Covers the zero-batches case (e.g. an empty/already-clean catalog): the
  // loop above breaks before saveCheckpoint ever runs, so this directory may
  // not exist yet — and a custom --report-out could point elsewhere entirely.
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
