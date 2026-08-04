import type { Executor } from "../../db/tx";
import { emailAppLink } from "../lib/email/links";
import { queueTemplatedEmail } from "../services/email.service";

/** Sent exactly once right after a brand-new `users` row is created (A5-5). */
export async function sendWelcomeEmail(
  email: string,
  userId: string,
  transaction?: Executor
): Promise<void> {
  await queueTemplatedEmail({
    kind: "welcome",
    to: email,
    userId,
    dedupeKey: `welcome:${userId}`,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    transaction,
    template: "notification",
    props: {
      title: "Welcome to Thrivo",
      body: "Your account is ready. Log your first meal to see your daily calories in seconds — no hidden pricing, cancel anytime in two taps.",
      cta: { label: "Open Thrivo", url: emailAppLink("dashboard") },
    },
  });
}
