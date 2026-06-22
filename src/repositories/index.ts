// Namespaced repository barrel. Services import e.g. `userRepo.findById(...)`.
// Namespacing avoids collisions between same-named intent functions across repos.
export * as userRepo from "./user.repository";
export * as authIdentityRepo from "./auth-identity.repository";
export * as sessionRepo from "./session.repository";
export * as foodItemRepo from "./food-item.repository";
export * as foodLogRepo from "./food-log.repository";
export * as foodFavoriteRepo from "./food-favorite.repository";
export * as dailySummaryRepo from "./daily-summary.repository";
export * as streakRepo from "./streak.repository";
export * as checkInRepo from "./check-in.repository";
export * as weightEntryRepo from "./weight-entry.repository";
export * as waterIntakeRepo from "./water-intake.repository";
export * as subscriptionRepo from "./subscription.repository";
export * as emailCaptureRepo from "./email-capture.repository";
export * as emailLogRepo from "./email-log.repository";
export * as pushTokenRepo from "./push-token.repository";
export * as webhookEventRepo from "./webhook-event.repository";
export * as adminAuditLogRepo from "./admin-audit-log.repository";
