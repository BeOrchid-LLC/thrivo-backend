import type { Job } from "bullmq";
import { logger } from "../../lib/logger";
import { handleReconcileSummaries } from "./reconcile-summaries";
import { handleTrialReminder } from "./trial-reminder";
import { handleReconcileSubscriptions } from "./reconcile-subscriptions";
import { handleWeeklyReview } from "./weekly-review";
import { handleRelayEmailOutbox } from "./relay-email-outbox";
import { handleSnapshotMrr } from "./snapshot-mrr";
import { handleReconcileResendEvents } from "./reconcile-resend-events";
import { handleProcessAccountErasure } from "./process-account-erasure";

/**
 * Router for the `maintenance` queue. Scheduled system jobs share one queue and
 * are dispatched by job name, so adding a repeatable is one route entry + one
 * scheduler registration — no new queue/worker wiring.
 */
const routes: Record<string, (job: Job) => Promise<void>> = {
  "reconcile-daily-summaries": handleReconcileSummaries,
  "trial-reminder": handleTrialReminder,
  "reconcile-subscriptions": handleReconcileSubscriptions,
  "weekly-review": handleWeeklyReview,
  "relay-email-outbox": handleRelayEmailOutbox,
  "snapshot-mrr": handleSnapshotMrr,
  "reconcile-resend-events": handleReconcileResendEvents,
  "process-account-erasure": handleProcessAccountErasure,
};

export async function handleMaintenance(job: Job): Promise<void> {
  const route = routes[job.name];
  if (!route) {
    logger.warn({ jobId: job.id, jobName: job.name }, "unknown maintenance job");
    return;
  }
  logger.info({ jobId: job.id, jobName: job.name }, "maintenance job dispatching");
  return route(job);
}
