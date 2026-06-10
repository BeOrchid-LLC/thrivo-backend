import { closeDb } from "./index";
import { logger } from "../src/lib/logger";

/** Dev/staging fixtures. Real fixtures (tip bank, sample foods) are added with A2. */
async function seed(): Promise<void> {
  logger.info("seeding dev fixtures…");
  // TODO(A2): insert the static tip bank + a handful of sample foods.
  logger.info("seed complete");
}

seed()
  .then(closeDb)
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "seed failed");
    process.exit(1);
  });
