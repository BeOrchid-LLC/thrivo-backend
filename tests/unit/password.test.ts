import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../src/admin/password";

describe("hashPassword", () => {
  it("produces a scrypt$ prefixed string", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("includes three $ segments (algorithm, salt, hash)", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash.split("$").length).toBe(3);
  });

  it("generates different hashes for the same password (unique salts)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("hash is deterministic for a given salt embedded in the stored value", async () => {
    const hash = await hashPassword("deterministic");
    // verifyPassword re-derives using the stored salt — must round-trip
    expect(await verifyPassword("deterministic", hash)).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("returns true for the correct password", async () => {
    const stored = await hashPassword("Wenetoreth@2026");
    expect(await verifyPassword("Wenetoreth@2026", stored)).toBe(true);
  });

  it("returns false for the wrong password", async () => {
    const stored = await hashPassword("Wenetoreth@2026");
    expect(await verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("returns false for an empty password", async () => {
    const stored = await hashPassword("Wenetoreth@2026");
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("returns false for a malformed stored value (no $ separator)", async () => {
    expect(await verifyPassword("anything", "notvalid")).toBe(false);
  });

  it("returns false for wrong algorithm prefix", async () => {
    expect(await verifyPassword("anything", "bcrypt$salt$hash")).toBe(false);
  });

  it("returns false for only two $ segments", async () => {
    expect(await verifyPassword("anything", "scrypt$onlytwo")).toBe(false);
  });

  it("is case-sensitive", async () => {
    const stored = await hashPassword("CaseSensitive");
    expect(await verifyPassword("casesensitive", stored)).toBe(false);
  });
});
