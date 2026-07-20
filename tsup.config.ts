import { defineConfig } from "tsup";

/**
 * Bundles the process entrypoints into self-contained, natively-runnable ESM
 * under dist/ (the source uses extensionless imports under
 * moduleResolution:"bundler", which Node can't resolve on its own). Runtime deps
 * stay external — installed in the image's node_modules — so this only bundles
 * our own code. tsc (`npm run typecheck`) remains the type-safety gate; esbuild
 * here only strips types and links modules.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts", // API server
    worker: "src/jobs/worker.ts", // BullMQ worker process
    migrate: "db/migrate.ts", // forward-only migration runner
    "backfill-food-basis": "scripts/backfill-food-basis.ts", // R1-5 one-off data repair
    "backfill-streaks": "scripts/backfill-streaks.ts", // R4-3 one-off streak backfill
    "backfill-mrr-snapshots": "scripts/backfill-mrr-snapshots.ts", // B2a one-off mrr_snapshots backfill
    "backfill-subscription-event-prices": "scripts/backfill-subscription-event-prices.ts", // one-off subscription_events price backfill
    "backfill-food-log-item-ids": "scripts/backfill-food-log-item-ids.ts", // null food_logs.food_item_id repair
    "seed-admins": "db/seed-admins.ts", // idempotent super-admin bootstrap
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node22",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});
