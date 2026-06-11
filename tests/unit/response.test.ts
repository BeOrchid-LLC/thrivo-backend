import { describe, expect, it } from "vitest";
import { ok } from "../../src/lib/response";

describe("ok envelope", () => {
  it("wraps data without meta when none is given", () => {
    expect(ok({ id: 1 })).toEqual({ data: { id: 1 } });
  });

  it("includes meta when provided", () => {
    expect(ok([1, 2], { nextCursor: "abc" })).toEqual({ data: [1, 2], meta: { nextCursor: "abc" } });
  });
});
