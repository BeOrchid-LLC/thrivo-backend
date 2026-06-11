import { defineConfig } from "tsup";

/**
 * Bundles the three process entrypoints into self-contained, natively-runnable
 * ESM under dist/ (the source uses extensionless imports under
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
