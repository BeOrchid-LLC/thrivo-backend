import { vi } from "vitest";

// Global mock for @clerk/backend's verifyToken. Integration tests create
// sessions via tests/helpers/auth.ts which mints tokens in the format
// "test-clerk-token:<subjectId>:<email>". Any other token is rejected, matching
// production behaviour for non-Clerk tokens.
vi.mock("@clerk/backend", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@clerk/backend")>();
  return {
    ...mod,
    verifyToken: vi.fn(async (token: string) => {
      const parts = token.split(":");
      if (parts[0] !== "test-clerk-token" || parts.length < 3) {
        throw new Error("Invalid or non-test Clerk token");
      }
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
    }),
  };
});
