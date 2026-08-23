import type { Job } from "bullmq";
import { deleteRevenueCatCustomer } from "../../services/revenuecat.service";

type DeleteRevenueCatJob = Job<{ appUserIds?: string[] }>;

/** Idempotently remove any RevenueCat customer recreated after an erasure. */
export async function handleDeleteRevenueCatCustomer(job: DeleteRevenueCatJob): Promise<void> {
  for (const appUserId of [...new Set(job.data.appUserIds ?? [])]) {
    await deleteRevenueCatCustomer(appUserId);
  }
}
