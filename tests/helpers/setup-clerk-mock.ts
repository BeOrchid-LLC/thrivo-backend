import { vi } from "vitest";

// Global mock for @clerk/backend's verifyToken.
//
// Two token formats are supported, each scoped to its Clerk app:
//   - "test-clerk-token:<sub>:<email>"        → consumer app (CLERK_SECRET_KEY)
//   - "test-clerk-admin-token:<sub>:<email>"  → admin app   (CLERK_ADMIN_SECRET_KEY)
//
// The secretKey parameter is checked so that admin tokens are silently rejected
// by the consumer verifyRequest path (and vice versa). This prevents authMiddleware
// from accidentally creating a users row when an admin Bearer is present.
vi.mock("@clerk/backend", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@clerk/backend")>();
  return {
    ...mod,
    verifyToken: vi.fn(async (token: string, options?: { secretKey?: string }) => {
      const key = options?.secretKey ?? "";
      const adminKey = process.env.CLERK_ADMIN_SECRET_KEY ?? "";
      const consumerKey = process.env.CLERK_SECRET_KEY ?? "";
      const parts = token.split(":");

      if (parts[0] === "test-clerk-admin-token" && parts.length >= 3 && key === adminKey) {
        const subjectId = parts[1]!;
        const email = parts.slice(2).join(":");
        return {
          sub: subjectId,
          email,
          email_verified: true,
          name: "Test User",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: "https://test.clerk.accounts.dev",
        };
      }

      if (parts[0] === "test-clerk-token" && parts.length >= 3 && key === consumerKey) {
        const subjectId = parts[1]!;
        const email = parts.slice(2).join(":");
        return {
          sub: subjectId,
          email,
          email_verified: true,
          name: "Test User",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: "https://test.clerk.accounts.dev",
        };
      }

      throw new Error("Invalid or non-test Clerk token");
    }),
  };
});
