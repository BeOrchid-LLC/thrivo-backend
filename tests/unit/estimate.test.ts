import { afterEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../src/integrations/anthropic/client", () => ({
  getAnthropic: () => ({ messages: { create } }),
  isAnthropicConfigured: () => true,
}));

import { estimateNutritionViaModel } from "../../src/integrations/anthropic/estimate";

const payload = { name: "Jollof rice", portionMeasure: "serving" as const, quantity: 1 };

function modelReturns(obj: unknown) {
  create.mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify(obj) }] });
}

describe("estimateNutritionViaModel", () => {
  afterEach(() => vi.clearAllMocks());

  it("validates, clamps absurd magnitudes, and rounds", async () => {
    modelReturns({ calories: 99999, proteinG: -10, carbsG: 50.6, fatG: 9999 });
    const out = await estimateNutritionViaModel(payload);
    expect(out.calories).toBe(5000); // clamped to the single-meal ceiling
    expect(out.proteinG).toBe(0); // negative floored to 0
    expect(out.carbsG).toBe(51); // rounded
    expect(out.fatG).toBe(500); // clamped
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 160 }));
  });

  it("rejects unparseable model output rather than trusting it", async () => {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: "sorry, not JSON" }] });
    await expect(estimateNutritionViaModel(payload)).rejects.toThrow();
  });
});
