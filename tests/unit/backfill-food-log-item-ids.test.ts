import { describe, expect, it } from "vitest";
import { inferReferenceGrams } from "../../scripts/backfill-food-log-item-ids";

describe("backfill-food-log-item-ids: inferReferenceGrams", () => {
  it("reads a bare grams unit as 1g", () => {
    expect(inferReferenceGrams("g")).toBe(1);
    expect(inferReferenceGrams("gram")).toBe(1);
    expect(inferReferenceGrams("grams")).toBe(1);
    expect(inferReferenceGrams("Grams")).toBe(1);
  });

  it("extracts an explicit gram amount from the serving-unit text", () => {
    expect(inferReferenceGrams("150g")).toBe(150);
    expect(inferReferenceGrams("150 g")).toBe(150);
    expect(inferReferenceGrams("200 grams")).toBe(200);
    expect(inferReferenceGrams("1 serving (100g)")).toBe(100);
  });

  it("never fabricates a gram basis for non-gram units — returns null so the row gets flagged", () => {
    expect(inferReferenceGrams("1 cup")).toBeNull();
    expect(inferReferenceGrams("1 serving")).toBeNull();
    expect(inferReferenceGrams("2 tbsp")).toBeNull();
    expect(inferReferenceGrams(null)).toBeNull();
    expect(inferReferenceGrams("")).toBeNull();
    expect(inferReferenceGrams("   ")).toBeNull();
  });

  it("rejects a zero or malformed gram amount rather than treating it as a valid basis", () => {
    expect(inferReferenceGrams("0g")).toBeNull();
    expect(inferReferenceGrams("gsomething")).toBeNull();
  });
});
