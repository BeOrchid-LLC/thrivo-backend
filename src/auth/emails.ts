import { sendTemplatedEmail } from "../services/email.service";

/** Sent exactly once right after a brand-new `users` row is created (A5-5). */
export async function sendWelcomeEmail(email: string, userId: string): Promise<void> {
  await sendTemplatedEmail({
    to: email,
    userId,
    template: "notification",
    props: {
      title: "Welcome to Thrivo",
      body: "Your account is ready. Log your first meal to see your daily calories in seconds — no hidden pricing, cancel anytime in two taps.",
      cta: { label: "Open Thrivo", url: "https://thrivo.fit/app" },
    },
  });
}
