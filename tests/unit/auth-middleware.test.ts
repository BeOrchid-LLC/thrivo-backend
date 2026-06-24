import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

const { verifyRequest } = vi.hoisted(() => ({ verifyRequest: vi.fn() }));
vi.mock("../../src/auth", () => ({ verifyRequest }));
const { findByAuthSubjectId } = vi.hoisted(() => ({ findByAuthSubjectId: vi.fn() }));
vi.mock("../../src/repositories", () => ({ userRepo: { findByAuthSubjectId } }));

import { authMiddleware } from "../../src/middleware/auth";
import type { AppEnv } from "../../src/types/http";

function app() {
  const a = new Hono<AppEnv>();
  a.use(authMiddleware);
  a.get("/", (c) => c.json({ user: c.var.user ?? null }));
  return a;
}

describe("auth middleware", () => {
  afterEach(() => vi.clearAllMocks());

  it("resolves a principal to c.var.user", async () => {
    verifyRequest.mockResolvedValue({ subjectId: "s1", email: "a@b.com", emailVerified: true });
    findByAuthSubjectId.mockResolvedValue({ id: "u1", email: "a@b.com" });

    const body = (await (await app().request("/")).json()) as { user: { id: string } | null };
    expect(body.user?.id).toBe("u1");
    expect(findByAuthSubjectId).toHaveBeenCalledWith("s1");
  });

  it("leaves the request anonymous when the user row is missing", async () => {
    verifyRequest.mockResolvedValue({ subjectId: "s1", email: "a@b.com", emailVerified: true });
    findByAuthSubjectId.mockResolvedValue(null);

    const body = (await (await app().request("/")).json()) as { user: unknown };
    expect(body.user).toBeNull();
  });

  it("leaves the request anonymous when there is no session", async () => {
    verifyRequest.mockResolvedValue(null);

    const body = (await (await app().request("/")).json()) as { user: unknown };
    expect(body.user).toBeNull();
    expect(findByAuthSubjectId).not.toHaveBeenCalled();
  });
});
