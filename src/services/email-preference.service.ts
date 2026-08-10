import { settingsRepo, userRepo } from "../repositories";
import { ValidationError } from "../lib/errors";
import { verifyWeeklyReviewPreferenceToken } from "../lib/email/preference-token";

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

async function resolveToken(token: string) {
  try {
    const userId = await verifyWeeklyReviewPreferenceToken(token);
    const user = await userRepo.findById(userId);
    if (!user) throw new Error("User unavailable");
    return user;
  } catch {
    throw new ValidationError("Invalid email preference link");
  }
}

export async function getWeeklyReviewPreference(token: string) {
  const user = await resolveToken(token);
  const settings = await settingsRepo.getOrCreateUserSettings(user.id);
  return { enabled: settings.weeklyReviewEmailEnabled, recipient: maskEmail(user.email) };
}

export async function disableWeeklyReviewEmail(token: string) {
  const user = await resolveToken(token);
  await settingsRepo.updateUserSettings(user.id, {
    weeklyReviewEmailEnabled: false,
    emailFoodLogReminderEnabled: false,
  });
  return { enabled: false, recipient: maskEmail(user.email) };
}
