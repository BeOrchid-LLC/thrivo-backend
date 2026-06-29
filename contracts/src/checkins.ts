import { z } from "zod";
import { idSchema, isoDateSchema, localDaySchema } from "./common";

// Canonical mood values. These MUST match the `mood` Postgres enum
// (db/schema/_enums.ts: great | good | ok | low | bad) — the value is stored
// as-is, while the UI is free to render its own label (e.g. "Okay" for "ok").
export const moodSchema = z.enum(["great", "good", "ok", "low", "bad"]);
export type Mood = z.infer<typeof moodSchema>;

export const checkinSchema = z.object({
  id: idSchema,
  mood: moodSchema,
  day: localDaySchema,
  note: z.string().nullable(),
  /** Server-selected psychology tip returned for the chosen mood / day. */
  tip: z.string().nullable(),
  createdAt: isoDateSchema,
});
export type Checkin = z.infer<typeof checkinSchema>;

export const createCheckinPayload = z.object({
  mood: moodSchema,
  day: localDaySchema,
  note: z.string().max(500).optional(),
});
export type CreateCheckinPayload = z.infer<typeof createCheckinPayload>;

export const checkinResponse = z.object({ checkin: checkinSchema });
export type CheckinResponse = z.infer<typeof checkinResponse>;

export const checkinListResponse = z.object({ checkins: z.array(checkinSchema) });
export type CheckinListResponse = z.infer<typeof checkinListResponse>;
