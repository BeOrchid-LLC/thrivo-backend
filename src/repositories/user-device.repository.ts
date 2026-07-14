import { eq } from "drizzle-orm";
import { db } from "../../db";
import type { Executor } from "../../db/tx";
import { userDevices, type NewUserDeviceRow, type UserDeviceRow } from "../../db/schema";

export type UserDevice = UserDeviceRow;

export async function getByUser(userId: string, tx: Executor = db): Promise<UserDevice | null> {
  const [row] = await tx.select().from(userDevices).where(eq(userDevices.userId, userId)).limit(1);
  return row ?? null;
}

/** One row per user — upsert on the unique `user_id`. No caller yet (future
 *  mobile-app instrumentation writes here at app-open/push-token registration). */
export async function upsert(input: NewUserDeviceRow, tx: Executor = db): Promise<UserDevice> {
  const { id: _id, createdAt: _c, ...set } = input;
  const [row] = await tx
    .insert(userDevices)
    .values(input)
    .onConflictDoUpdate({ target: userDevices.userId, set })
    .returning();
  return row;
}
