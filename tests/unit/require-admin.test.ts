/**
 * Tests for requireAdmin, requireAdminRole, and requireSuperAdmin.
 *
 * requireAdmin verifies the Bearer JWT via the BeOrchid Admin Clerk app, then
 * resolves the caller's admin_users row via a Redis snapshot / DB fallback.
 * requireAdminRole / requireSuperAdmin are role gates that run AFTER requireAdmin.
 *
 * The global setup-clerk-mock.ts mocks @clerk/backend's verifyToken to accept
 * "test-clerk-token:<sub>:<email>" tokens, so tests here use that format.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../src/middleware/error";
import type { AppEnv } from "../../src/types/http";
import type { AdminClaims } from "../../src/admin/session.service";

// ─── mocks (hoisted so vi.mock() calls can reference them) ──────────────────

const { getAdminSnapshot, setAdminSnapshot } = vi.hoisted(() => ({
  getAdminSnapshot: vi.fn(),
  setAdminSnapshot: vi.fn(async () => undefined),
}));
vi.mock("../../src/admin/snapshot.service", () => ({ getAdminSnapshot, setAdminSnapshot }));

const { findByEmail, findByClerkAdminId } = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  findByClerkAdminId: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/repositories", () => ({
  adminAccountRepo: { findByEmail, findByClerkAdminId },
}));

// ─── imports that depend on the mocks above ──────────────────────────────────

import {
  requireAdmin,
  requireAdminRole,
  requireSuperAdmin,
} from "../../src/middleware/require-admin";

// ─── helpers ─────────────────────────────────────────────────────────────────

type AdminRole = AdminClaims["role"];

/** Create a test app that runs requireAdmin then serves /. */
function adminApp() {
  const a = new Hono<AppEnv>();
  a.onError(errorHandler);
  a.get("/", requireAdmin, (c) => c.json({ role: c.var.adminUser?.role ?? null }));
  return a;
}

/** Create a test app that skips requireAdmin and injects a pre-built adminUser,
 *  then gates on requireAdminRole(min). */
function roleApp(role: AdminRole | null, min: AdminRole) {
  const a = new Hono<AppEnv>();
  a.onError(errorHandler);
  a.use(async (c, next) => {
    if (role) {
      c.set("adminUser", { id: "a1", email: "t@example.com", name: null, role } as AdminClaims);
    }
    await next();
  });
  a.get("/", requireAdminRole(min), (c) => c.json({ ok: true }));
  return a;
}

/**
 * Issue a GET / with a Bearer token. The default is a valid test-clerk-token
 * accepted by the global @clerk/backend mock in setup-clerk-mock.ts.
 */
function req(app: Hono<AppEnv>, bearer = "Bearer test-clerk-admin-token:test_user:t@example.com") {
  return app.request("/", { headers: { authorization: bearer } });
}

// ─── requireAdmin ────────────────────────────────────────────────────────────

describe("requireAdmin", () => {
  afterEach(() => vi.clearAllMocks());

  it("401 when no bearer token is present", async () => {
    const res = await adminApp().request("/");
    expect(res.status).toBe(401);
  });

  it("401 when Clerk token is invalid", async () => {
    expect((await req(adminApp(), "Bearer not-a-clerk-token")).status).toBe(401);
  });

  it("401 when snapshot shows disabled status", async () => {
    getAdminSnapshot.mockResolvedValue({
      id: "a1",
      email: "t@example.com",
      name: null,
      role: "admin",
      status: "disabled",
    });
    expect((await req(adminApp())).status).toBe(401);
  });

  it("401 when DB row is missing (no snapshot, no row)", async () => {
    getAdminSnapshot.mockResolvedValue(null);
    findByClerkAdminId.mockResolvedValue(null);
    findByEmail.mockResolvedValue(null);
    expect((await req(adminApp())).status).toBe(401);
  });

  it("401 when DB row is disabled (snapshot miss, DB is source of truth)", async () => {
    getAdminSnapshot.mockResolvedValue(null);
    findByClerkAdminId.mockResolvedValue(null);
    findByEmail.mockResolvedValue({
      id: "a1",
      email: "t@example.com",
      name: null,
      role: "admin",
      status: "disabled",
    });
    expect((await req(adminApp())).status).toBe(401);
  });

  it("200 and sets adminUser from cached snapshot", async () => {
    getAdminSnapshot.mockResolvedValue({
      id: "a1",
      email: "t@example.com",
      name: null,
      role: "support",
      status: "active",
    });
    const res = await req(adminApp());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { role: string }).role).toBe("support");
  });

  it("200 and populates snapshot from DB on cache miss (read-through)", async () => {
    getAdminSnapshot.mockResolvedValue(null);
    findByClerkAdminId.mockResolvedValue(null);
    findByEmail.mockResolvedValue({
      id: "a1",
      email: "t@example.com",
      name: null,
      role: "admin",
      status: "active",
    });
    const res = await req(adminApp());
    expect(res.status).toBe(200);
    expect(setAdminSnapshot).toHaveBeenCalled();
  });
});

// ─── requireAdminRole ────────────────────────────────────────────────────────

describe("requireAdminRole", () => {
  afterEach(() => vi.clearAllMocks());

  it("401 when adminUser is not in context", async () => {
    const res = await roleApp(null, "support").request("/");
    expect(res.status).toBe(401);
  });

  it("read-only is denied when support is required", async () => {
    expect((await req(roleApp("read-only", "support"))).status).toBe(403);
  });

  it("support satisfies support requirement", async () => {
    expect((await req(roleApp("support", "support"))).status).toBe(200);
  });

  it("support is denied when admin is required", async () => {
    expect((await req(roleApp("support", "admin"))).status).toBe(403);
  });

  it("admin satisfies admin requirement", async () => {
    expect((await req(roleApp("admin", "admin"))).status).toBe(200);
  });

  it("admin is denied when super-admin is required", async () => {
    expect((await req(roleApp("admin", "super-admin"))).status).toBe(403);
  });

  it("super-admin satisfies every role requirement", async () => {
    for (const min of ["read-only", "support", "admin", "super-admin"] as const) {
      expect((await req(roleApp("super-admin", min))).status).toBe(200);
    }
  });
});

// ─── requireSuperAdmin convenience alias ──────────────────────────────────────

describe("requireSuperAdmin", () => {
  afterEach(() => vi.clearAllMocks());

  it("is an alias for requireAdminRole('super-admin') — admin is denied", async () => {
    const a = new Hono<AppEnv>();
    a.onError(errorHandler);
    a.use(async (c, next) => {
      c.set("adminUser", {
        id: "a1",
        email: "t@example.com",
        name: null,
        role: "admin",
      } as AdminClaims);
      await next();
    });
    a.get("/", requireSuperAdmin, (c) => c.json({ ok: true }));
    expect((await a.request("/")).status).toBe(403);
  });

  it("super-admin is allowed", async () => {
    const a = new Hono<AppEnv>();
    a.onError(errorHandler);
    a.use(async (c, next) => {
      c.set("adminUser", {
        id: "a1",
        email: "t@example.com",
        name: null,
        role: "super-admin",
      } as AdminClaims);
      await next();
    });
    a.get("/", requireSuperAdmin, (c) => c.json({ ok: true }));
    expect((await a.request("/")).status).toBe(200);
  });
});
