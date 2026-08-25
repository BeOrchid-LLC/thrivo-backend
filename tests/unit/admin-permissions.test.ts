import { describe, expect, it } from "vitest";
import { effectivePermissions, permissionsForRole } from "../../src/admin/permissions";

describe("admin permission presets", () => {
  it("gives read-only staff only read capabilities", () => {
    const permissions = permissionsForRole("read-only");
    expect(permissions).toContain("users.read");
    expect(permissions).not.toContain("users.manage");
    expect(permissions).not.toContain("settings.manage");
  });

  it("resolves null to the role defaults", () => {
    expect(effectivePermissions("admin", null)).toEqual(permissionsForRole("admin"));
  });

  it("filters unknown explicit permissions", () => {
    expect(effectivePermissions("support", ["content.manage", "not-a-permission"])).toEqual([
      "content.manage",
    ]);
  });
});
