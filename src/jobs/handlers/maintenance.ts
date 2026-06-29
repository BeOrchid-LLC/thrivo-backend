import type { Job } from "bullmq";
import { logger } from "../../lib/logger";
import { handleReconcileSummaries } from "./reconcile-summaries";
import { handleTrialReminder } from "./trial-reminder";
import { handleReconcileSubscriptions } from "./reconcile-subscriptions";

/**
 * Router for the `maintenance` queue. Scheduled system jobs share one queue and
 * are dispatched by job name, so adding a repeatable is one route entry + one
 * scheduler registration — no new queue/worker wiring.
 */
const routes: Record<string, (job: Job) => Promise<void>> = {
  "reconcile-daily-summaries": handleReconcileSummaries,
  "trial-reminder": handleTrialReminder,
  "reconcile-subscriptions": handleReconcileSubscriptions,
};

export async function handleMaintenance(job: Job): Promise<void> {
  const route = routes[job.name];
  if (!route) {
    logger.warn({ jobName: job.name }, "unknown maintenance job");
    return;
  }
  return route(job);
}
