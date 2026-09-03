import type { Job } from "bullmq";
import { purgeOldWebAccountDeletionRequests } from "../../services/account-deletion-web.service";

export async function handlePurgeAccountDeletionWebRequests(_job: Job): Promise<void> {
  await purgeOldWebAccountDeletionRequests();
}
