import { describe, expect, it } from "vitest";
import { decryptEmailPayload, encryptEmailPayload } from "../../src/lib/email/outbox-crypto";

describe("email outbox encryption", () => {
  it("round-trips a payload using authenticated email identity context", () => {
    const value = { to: "person@example.com", props: { code: "123456" } };
    const encrypted = encryptEmailPayload(value, "log_1", "admin_otp");

    expect(encrypted.ciphertext).not.toContain("123456");
    expect(decryptEmailPayload(encrypted, "log_1", "admin_otp")).toEqual(value);
  });

  it("rejects the wrong log id or email kind as tampered authenticated context", () => {
    const encrypted = encryptEmailPayload({ secret: "value" }, "log_1", "welcome");

    expect(() => decryptEmailPayload(encrypted, "log_2", "welcome")).toThrow();
    expect(() => decryptEmailPayload(encrypted, "log_1", "weekly_review")).toThrow();
  });

  it("rejects modified ciphertext", () => {
    const encrypted = encryptEmailPayload({ secret: "value" }, "log_1", "welcome");
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;

    expect(() =>
      decryptEmailPayload(
        { ...encrypted, ciphertext: ciphertext.toString("base64") },
        "log_1",
        "welcome"
      )
    ).toThrow();
  });
});
