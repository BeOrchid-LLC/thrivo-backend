import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../../env";

export interface EncryptedEmailPayload {
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

function configuredKeys(): Record<string, Buffer> {
  if (env.EMAIL_OUTBOX_ENCRYPTION_KEYS) {
    const parsed = JSON.parse(env.EMAIL_OUTBOX_ENCRYPTION_KEYS) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed).map(([keyId, encoded]) => [keyId, Buffer.from(encoded, "base64")])
    );
  }

  // Development/test fallback only. Production configuration is rejected by envSchema.
  return { development: createHash("sha256").update(env.AUTH_SECRET).digest() };
}

function activeKey(): { keyId: string; key: Buffer } {
  const keys = configuredKeys();
  const keyId = env.EMAIL_OUTBOX_ACTIVE_KEY_ID ?? "development";
  const key = keys[keyId];
  if (!key || key.length !== 32)
    throw new Error(`Email outbox encryption key ${keyId} unavailable`);
  return { keyId, key };
}

export function encryptEmailPayload(
  value: unknown,
  emailLogId: string,
  kind: string
): EncryptedEmailPayload {
  const { keyId, key } = activeKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${emailLogId}:${kind}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    keyId,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptEmailPayload<T>(
  payload: EncryptedEmailPayload,
  emailLogId: string,
  kind: string
): T {
  const key = configuredKeys()[payload.keyId];
  if (!key) throw new Error(`Email outbox decryption key ${payload.keyId} unavailable`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAAD(Buffer.from(`${emailLogId}:${kind}`, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
