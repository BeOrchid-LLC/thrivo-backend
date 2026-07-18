import type {
  CheckinListResponse,
  CheckinResponse,
  CreateCheckinPayload,
} from "../../contracts/src/checkins";
import { checkInRepo, tipRepo } from "../repositories";
import type { CheckIn } from "../repositories/check-in.repository";
import type { User } from "../repositories/user.repository";
import { selectDailyTip } from "./nudge.service";

function toCheckin(row: CheckIn, tipBody: string | null): CheckinResponse["checkin"] {
  return {
    id: row.id,
    mood: row.mood,
    day: row.localDate,
    // A note redacted by admin moderation (hiddenAt set) is suppressed from the
    // user-facing read — the mood/day/tip remain, only the free text is hidden.
    note: row.hiddenAt ? null : row.note,
    tip: tipBody,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Record (or update) today's mood check-in and return it with the day's tip.
 * One check-in per day — re-checking in updates it. The tip reuses the same
 * daily-rotation selection that powers the nudge, so the in-app check-in and the
 * push nudge surface a consistent message.
 */
export async function createCheckin(
  user: User,
  payload: CreateCheckinPayload
): Promise<CheckinResponse> {
  const tip = await selectDailyTip(payload.day);
  const row = await checkInRepo.upsertForDay({
    userId: user.id,
    localDate: payload.day,
    mood: payload.mood,
    note: payload.note ?? null,
    tipId: tip?.id ?? null,
  });
  return { checkin: toCheckin(row, tip?.body ?? null) };
}

export async function listCheckins(user: User): Promise<CheckinListResponse> {
  const rows = await checkInRepo.listForUser(user.id);
  const tipIds = rows.map((row) => row.tipId).filter((id): id is string => Boolean(id));
  const tips = await tipRepo.findByIds(tipIds);
  return {
    checkins: rows.map((row) =>
      toCheckin(row, row.tipId ? (tips.get(row.tipId)?.body ?? null) : null)
    ),
  };
}
