import { describe, expect, it } from "vitest";
import { newId } from "../../src/lib/ids";

describe("ids", () => {
  it("generates RFC-4122 v7 uuids", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is monotonically sortable over time", async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 2));
    const b = newId();
    expect(a < b).toBe(true);
  });

  it("is unique across a batch", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });
});
