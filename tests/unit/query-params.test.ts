import { describe, expect, it } from "vitest";
import { queryBooleanSchema } from "../../src/lib/query-params";

describe("queryBooleanSchema", () => {
  it("parses explicit true and false query values correctly", () => {
    expect(queryBooleanSchema.parse("true")).toBe(true);
    expect(queryBooleanSchema.parse("1")).toBe(true);
    expect(queryBooleanSchema.parse("false")).toBe(false);
    expect(queryBooleanSchema.parse("0")).toBe(false);
  });

  it("rejects ambiguous values instead of silently treating them as true", () => {
    expect(queryBooleanSchema.safeParse("sometimes").success).toBe(false);
  });
});
