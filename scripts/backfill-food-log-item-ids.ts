/**
 * One-time backfill: attach food_item_id to food_logs that were written before
 * catalog-first logging (search snapshots / describe-meal with null FK).
 *
 * Resolution order per null-id log:
 *   1. barcode → findActiveByBarcode / upsertOffProduct (apply only for OFF write)
 *   2. personal item owned by the log user with the same name
 *   3. create a personal item from the log snapshot (manual → origin_ref=estimate)
 *
 * Never rewrites kcal/macro snapshot columns — only sets food_item_id.
 *
 * Dry-run by default. Nothing is written unless --apply is passed. Checkpointed
 * by food_logs.id (keyset) so a crash/interrupt resumes instead of restarting.
 * Checkpoint/report files default to os.tmpdir() (deployed /app is not writable).
 *
 * Usage (local):
 *   npm run backfill:food-log-item-ids -- [--apply] [--batch-size=200]
 *                                         [--max-batches=N] [--reset]
 *                                         [--checkpoint-dir=path] [--report-out=path.json]
 *
 * Usage (Coolify API container — INFRA_SETUP_GUIDE §15):
 *   node dist/backfill-food-log-item-ids.js
 *   node dist/backfill-food-log-item-ids.js --apply
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeDb, db } from "../db";
import type { FoodLogRow } from "../db/schema";
import { fetchOpenFoodFactsProduct } from "../src/integrations/open-food-facts";
import { logger } from "../src/lib/logger";
import { foodItemRepo, foodLogRepo } from "../src/repositories";
import { upsertOffProduct } from "../src/services/food.service";

const DEFAULT_CHECKPOINT_DIR = path.join(os.tmpdir(), "thrivo-backfill-food-log-item-ids");
const OFF_REQUEST_DELAY_MS = 300;

interface Checkpoint {
  lastLogId: string | null;
  scanned: number;
  linkedByBarcode: number;
  linkedByName: number;
  createdPersonal: number;
  flagged: Array<{ logId: string; reason: string }>;
  startedAt: string;
  updatedAt: string;
}

function freshCheckpoint(): Checkpoint {
  const now = new Date().toISOString();
  return {
    lastLogId: null,
    scanned: 0,
    linkedByBarcode: 0,
    linkedByName: 0,
    createdPersonal: 0,
    flagged: [],
    startedAt: now,
    updatedAt: now,
  };
}

async function loadCheckpoint(checkpointPath: string, reset: boolean): Promise<Checkpoint> {
  if (!reset) {
    try {
      return JSON.parse(await readFile(checkpointPath, "utf8")) as Checkpoint;
    } catch {
      // No checkpoint yet.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function inferReferenceGrams(servingUnit: string | null): number | null {
  const normalized = servingUnit?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized === "g" || normalized === "gram" || normalized === "grams") return 1;
  const match = /(?:^|[ (])(\d+(?:\.\d+)?)\s*g(?:ram)?s?(?:$|[ )])/i.exec(normalized);
  if (!match) return null;
  const grams = Number(match[1]);
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}
type ResolveResult =
  | { foodItemId: string; via: "barcode" | "name" | "created" }
  | { foodItemId: null; via: "barcode" | "name" | "created"; pendingWrite: true };

async function resolveFoodItemId(
  log: FoodLogRow,
  apply: boolean,
  checkpoint: Checkpoint
): Promise<ResolveResult | null> {
  if (log.barcode) {
    const cached = await foodItemRepo.findActiveByBarcode(log.barcode);
    if (cached) return { foodItemId: cached.id, via: "barcode" };

    if (apply) {
      try {
        const upstream = await fetchOpenFoodFactsProduct(log.barcode);
        await sleep(OFF_REQUEST_DELAY_MS);
        if (upstream) {
          const item = await upsertOffProduct(upstream);
          return { foodItemId: item.id, via: "barcode" };
        }
      } catch (err) {
        logger.warn({ err, barcode: log.barcode, logId: log.id }, "backfill: OFF lookup failed");
      }
    } else {
      // Dry-run: barcode miss would hit OFF on apply; count as barcode-linked without writing.
      // If OFF would miss too, apply falls through to name/create — dry-run over-counts barcode.
      return { foodItemId: null, via: "barcode", pendingWrite: true };
    }
  }

  const byName = await foodItemRepo.findPersonalByName(log.userId, log.name);
  if (byName) return { foodItemId: byName.id, via: "name" };

  const quantity = toNumber(log.servingQty) || 1;
  if (quantity <= 0) {
    checkpoint.flagged.push({ logId: log.id, reason: "non_positive_servings" });
    return null;
  }
  const referenceGrams = inferReferenceGrams(log.servingUnit);
  if (!referenceGrams) {
    checkpoint.flagged.push({ logId: log.id, reason: "missing_reference_grams" });
    return null;
  }

  if (!apply) {
    return { foodItemId: null, via: "created", pendingWrite: true };
  }

  const created = await db.transaction(async (tx) => {
    const item = await foodItemRepo.insertItem(
      {
        tier: "personal",
        status: "active",
        origin: "personal",
        originRef: log.source === "manual" ? "estimate" : null,
        name: log.name,
        barcode: log.barcode,
        createdBy: log.userId,
        ownerUserId: log.userId,
      },
      tx
    );
    await foodItemRepo.upsertNutrients(
      {
        foodItemId: item.id,
        basis: "per_serving",
        servingLabel: log.servingUnit ?? "serving",
        servingG: String(referenceGrams),
        kcal: String(log.kcal / quantity),
        proteinG: String(toNumber(log.proteinG) / quantity),
        carbsG: String(toNumber(log.carbsG) / quantity),
        fatG: String(toNumber(log.fatG) / quantity),
        dataCompleteness: log.source === "manual" ? "0.4" : "0.5",
      },
      tx
    );
    return item;
  });

  return { foodItemId: created.id, via: "created" };
}

async function processLog(log: FoodLogRow, args: Args, checkpoint: Checkpoint): Promise<void> {
  checkpoint.scanned += 1;
  checkpoint.lastLogId = log.id;

  if (log.foodItemId) return;

  const resolved = await resolveFoodItemId(log, args.apply, checkpoint);
  if (!resolved) return;

  logger.info(
    {
      logId: log.id,
      foodItemId: "foodItemId" in resolved ? resolved.foodItemId : null,
      via: resolved.via,
      apply: args.apply,
    },
    "backfill: food_item_id resolved"
  );

  if (args.apply && resolved.foodItemId) {
    await foodLogRepo.updateLog(log.id, log.loggedAt, { foodItemId: resolved.foodItemId });
  }

  if (resolved.via === "barcode") checkpoint.linkedByBarcode += 1;
  else if (resolved.via === "name") checkpoint.linkedByName += 1;
  else checkpoint.createdPersonal += 1;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const checkpointDir = args.checkpointDir ?? DEFAULT_CHECKPOINT_DIR;
  const checkpointPath = path.join(
    checkpointDir,
    `food-log-item-ids-backfill-${args.apply ? "apply" : "dryrun"}.json`
  );
  const checkpoint = await loadCheckpoint(checkpointPath, args.reset);
  logger.info(
    {
      apply: args.apply,
      batchSize: args.batchSize,
      resumingFrom: checkpoint.lastLogId,
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

    const batch = await foodLogRepo.listNullFoodItemIdAfter(checkpoint.lastLogId, args.batchSize);
    if (batch.length === 0) break;

    for (const log of batch) {
      await processLog(log, args, checkpoint);
    }

    await saveCheckpoint(checkpointPath, checkpoint);
    batches += 1;
    logger.info(
      {
        scanned: checkpoint.scanned,
        linkedByBarcode: checkpoint.linkedByBarcode,
        linkedByName: checkpoint.linkedByName,
        createdPersonal: checkpoint.createdPersonal,
        flagged: checkpoint.flagged.length,
      },
      "backfill: batch complete"
    );
  }

  const reportPath =
    args.reportOut ??
    path.join(
      checkpointDir,
      `food-log-item-ids-backfill-report-${args.apply ? "apply" : "dryrun"}.json`
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
