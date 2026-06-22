import { createHash, randomBytes } from "node:crypto";

/** Hex SHA-256. Used to store opaque tokens (refresh, magic-link) by hash only. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Cryptographically-random URL-safe token (default 256 bits of entropy). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** base64url(SHA-256(value)) — the PKCE S256 code-challenge transform. */
export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
