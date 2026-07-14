import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyAppleIdentityToken } = vi.hoisted(() => ({
  verifyAppleIdentityToken: vi.fn(),
}));
const { accountRepo, authIdentityRepo } = vi.hoisted(() => ({
  accountRepo: { findByProvider: vi.fn(), create: vi.fn() },
  authIdentityRepo: { findById: vi.fn(), upsertByEmail: vi.fn() },
}));
const { issueSession, principalOf } = vi.hoisted(() => ({
  issueSession: vi.fn(async () => ({
    accessToken: "access",
    refreshToken: "refresh",
    refreshExpiresAt: new Date("2026-07-01T00:00:00Z"),
  })),
  // principalOf is an identity pass-through for assertion convenience.
  principalOf: vi.fn((identity: unknown) => identity),
}));
const { resolveUser } = vi.hoisted(() => ({ resolveUser: vi.fn() }));
const { sendWelcomeEmail } = vi.hoisted(() => ({ sendWelcomeEmail: vi.fn() }));

vi.mock("../../src/auth/oauth/apple.client", () => ({ verifyAppleIdentityToken }));
vi.mock("../../src/repositories", () => ({ accountRepo, authIdentityRepo }));
vi.mock("../../src/auth/session.service", () => ({ issueSession, principalOf }));
vi.mock("../../src/services/identity.service", () => ({ resolveUser }));
vi.mock("../../src/auth/emails", () => ({ sendWelcomeEmail }));
// db.transaction runs its callback with a sentinel tx the mocked repos ignore.
vi.mock("../../db", () => ({ db: { transaction: (cb: (tx: unknown) => unknown) => cb("tx") } }));

import { completeAppleSignIn } from "../../src/auth/oauth/apple.service";

describe("completeAppleSignIn", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves an existing linked account without creating a new one", async () => {
    verifyAppleIdentityToken.mockResolvedValue({
      sub: "apple-1",
      email: undefined,
      emailVerified: false,
    });
    accountRepo.findByProvider.mockResolvedValue({ userId: "u-existing" });
    authIdentityRepo.findById.mockResolvedValue({ id: "u-existing", email: "a@b.co" });
    resolveUser.mockResolvedValue({ user: { id: "u-existing" }, created: false });

    const tokens = await completeAppleSignIn("tok", undefined);

    expect(authIdentityRepo.findById).toHaveBeenCalledWith("u-existing", "tx");
    expect(authIdentityRepo.upsertByEmail).not.toHaveBeenCalled();
    expect(accountRepo.create).not.toHaveBeenCalled();
    expect(resolveUser).toHaveBeenCalled();
    expect(tokens.accessToken).toBe("access");
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it("provisions and links a first-time account when Apple supplies an email", async () => {
    verifyAppleIdentityToken.mockResolvedValue({
      sub: "apple-2",
      email: "new@user.co",
      emailVerified: true,
    });
    accountRepo.findByProvider.mockResolvedValue(null);
    authIdentityRepo.upsertByEmail.mockResolvedValue({ id: "u-new", email: "new@user.co" });
    resolveUser.mockResolvedValue({ user: { id: "u-new" }, created: true });

    await completeAppleSignIn("tok", "Ada Lovelace");

    expect(authIdentityRepo.upsertByEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@user.co", name: "Ada Lovelace", emailVerified: true }),
      "tx"
    );
    expect(accountRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "apple", accountId: "apple-2", userId: "u-new" }),
      "tx"
    );
    expect(sendWelcomeEmail).toHaveBeenCalledWith("new@user.co", "u-new");
  });

  it("rejects a first-time sign-in with no email to provision against", async () => {
    verifyAppleIdentityToken.mockResolvedValue({
      sub: "apple-3",
      email: undefined,
      emailVerified: false,
    });
    accountRepo.findByProvider.mockResolvedValue(null);

    await expect(completeAppleSignIn("tok", undefined)).rejects.toThrow(/email/i);
    expect(authIdentityRepo.upsertByEmail).not.toHaveBeenCalled();
  });
});
