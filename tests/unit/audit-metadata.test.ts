import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "../../src/lib/audit-metadata";

describe("audit metadata sanitization", () => {
  it("redacts sensitive keys recursively without changing operational values", () => {
    const input = {
      status: "failed",
      count: 2,
      recipient: { email: "user@example.com", userId: "user-1" },
      nested: [{ body: "private message", outcome: "queued" }],
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
    };

    expect(sanitizeAuditMetadata(input)).toEqual({
      status: "failed",
      count: 2,
      recipient: { email: "[redacted]", userId: "user-1" },
      nested: [{ body: "[redacted]", outcome: "queued" }],
      createdAt: "2026-08-29T00:00:00.000Z",
    });
  });

  it("preserves null and primitive metadata", () => {
    expect(sanitizeAuditMetadata(null)).toBeNull();
    expect(sanitizeAuditMetadata("queued")).toBe("queued");
    expect(sanitizeAuditMetadata(3)).toBe(3);
  });
});
