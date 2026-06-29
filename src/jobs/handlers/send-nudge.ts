import type { Job } from "bullmq";
import { sendDailyNudges } from "../../services/nudge.service";

/** Worker handler for the `nudges` queue: send the day's psychology tip push. */
export async function handleSendNudge(_job: Job): Promise<void> {
  await sendDailyNudges();
}
