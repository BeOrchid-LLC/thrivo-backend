import { randomBytes, createHash } from "node:crypto";

/** Generate a cryptographically random URL-safe token (32 bytes → 64 hex chars). */
export function randomToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 hex digest of a string. Used to store tokens at rest without the raw value. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
