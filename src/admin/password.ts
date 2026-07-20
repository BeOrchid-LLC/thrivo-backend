import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing for admin accounts using Node's built-in `scrypt` — no native
 * dependency (bcrypt/argon2 prebuilds are the exact class of thing that breaks
 * the Windows-lockfile → Linux-Docker build). Stored format is
 * `scrypt$<saltHex>$<hashHex>` so the salt travels with the hash and the
 * algorithm is self-describing.
 */
const scryptAsync = promisify(scrypt);
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

/**
 * Constant-time verify. Returns false (never throws) for any malformed stored
 * value or length mismatch so a corrupt row can't crash the login path.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}
