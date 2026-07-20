import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";
import type { AdminRole } from "./otp.service";

/**
 * Redis-cached admin authorization snapshot. Converts the stateless session JWT
 * into a cache-gated, revocable session while keeping the JWT for identity
 * integrity: `requireAdmin` verifies the JWT, then reads this snapshot to decide
 * whether the account is still active and at what role.
 *
 * Revocation model:
 *  - Read-through: a cache MISS is transparently re-read from the DB and
 *    repopulated, so a TTL-expired entry does NOT force a re-login.
 *  - Explicit invalidation: disable / role-change / delete / logout / password
 *    reset delete the entry. Because those writes also update the DB, the next
 *    request's re-read reflects the new state (disabled → 401) immediately.
 *
 * Keyed by email (stable + unique, and present in every JWT — including legacy
 * cookies whose `sub` was the email rather than a uuid).
 */
export type AdminSnapshot = {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  status: "invited" | "active" | "disabled";
};

/** Safety-net TTL. Explicit invalidation is what makes revocation immediate; this
 *  just bounds how long a stale snapshot can live if an invalidation is ever missed. */
const SNAPSHOT_TTL_SEC = 300;

const key = (email: string) => `admin:snapshot:${email.toLowerCase()}`;

/** Read the cached snapshot. Treats any Redis error as a miss (DB is the source
 *  of truth) so a Redis blip degrades to a DB read rather than locking out staff. */
export async function getAdminSnapshot(email: string): Promise<AdminSnapshot | null> {
  try {
    const raw = await getRedis().get(key(email));
    return raw ? (JSON.parse(raw) as AdminSnapshot) : null;
  } catch (err) {
    logger.warn({ err }, "admin snapshot read failed; falling back to DB");
    return null;
  }
}

/** Best-effort write; a cache write failure must never fail the request. */
export async function setAdminSnapshot(snapshot: AdminSnapshot): Promise<void> {
  try {
    await getRedis().set(key(snapshot.email), JSON.stringify(snapshot), "EX", SNAPSHOT_TTL_SEC);
  } catch (err) {
    logger.warn({ err }, "admin snapshot write failed");
  }
}

/** Delete the snapshot — the explicit-revocation path. Best-effort. */
export async function invalidateAdminSnapshot(email: string): Promise<void> {
  try {
    await getRedis().del(key(email));
  } catch (err) {
    logger.warn({ err }, "admin snapshot invalidation failed");
  }
}
