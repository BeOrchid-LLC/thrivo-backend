import type { Job } from "bullmq";
import { accountErasureRepo } from "../../repositories";

export async function handlePurgeErasureProofs(_job: Job): Promise<void> {
  const before = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await accountErasureRepo.purgeCompletedBefore(before);
}
