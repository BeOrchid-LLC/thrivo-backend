import { afterEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  findByAuthSubjectId: vi.fn(),
  findActiveByEmail: vi.fn(),
  linkAuthSubject: vi.fn(),
  createUser: vi.fn(),
}));
vi.mock("../../src/repositories", () => ({ userRepo: repo }));

import { resolveUser } from "../../src/services/identity.service";

const principal = { subjectId: "sub_1", email: "a@b.com", emailVerified: true, name: "Ada" };

describe("identity.service.resolveUser", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns the already-linked profile (by auth_subject_id)", async () => {
    repo.findByAuthSubjectId.mockResolvedValue({ id: "u1" });
    expect(await resolveUser(principal)).toEqual({ id: "u1" });
    expect(repo.findActiveByEmail).not.toHaveBeenCalled();
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it("links an existing profile found by verified email", async () => {
    repo.findByAuthSubjectId.mockResolvedValue(null);
    repo.findActiveByEmail.mockResolvedValue({ id: "u2" });
    repo.linkAuthSubject.mockResolvedValue({ id: "u2", authSubjectId: "sub_1" });

    const user = await resolveUser(principal);
    expect(repo.linkAuthSubject).toHaveBeenCalledWith("u2", "sub_1", expect.anything());
    expect(user).toEqual({ id: "u2", authSubjectId: "sub_1" });
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it("creates a fresh profile when nothing matches", async () => {
    repo.findByAuthSubjectId.mockResolvedValue(null);
    repo.findActiveByEmail.mockResolvedValue(null);
    repo.createUser.mockResolvedValue({ id: "u3" });

    await resolveUser(principal);
    expect(repo.createUser).toHaveBeenCalledWith(
      { email: "a@b.com", name: "Ada", authSubjectId: "sub_1" },
      expect.anything()
    );
  });

  it("falls back to the email local-part when the provider gives no name", async () => {
    repo.findByAuthSubjectId.mockResolvedValue(null);
    repo.findActiveByEmail.mockResolvedValue(null);
    repo.createUser.mockResolvedValue({ id: "u4" });

    await resolveUser({ subjectId: "sub_2", email: "noname@b.com", emailVerified: true });
    expect(repo.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: "noname" }),
      expect.anything()
    );
  });
});
