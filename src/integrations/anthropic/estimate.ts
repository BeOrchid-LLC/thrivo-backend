import { z } from "zod";
import { getAnthropic } from "./client";
import { env } from "../../env";
import { UpstreamError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import type { EstimateFoodPayload, Nutrients } from "../../../contracts/src/foods";

// Sane single-meal upper bounds. Model output is untrusted input: we validate
// the shape and clamp the magnitudes — never trust the raw numbers.
const MAX = { calories: 5000, proteinG: 500, carbsG: 800, fatG: 500 } as const;

const modelOutputSchema = z.object({
  calories: z.number().finite(),
  proteinG: z.number().finite(),
  carbsG: z.number().finite(),
  fatG: z.number().finite(),
});

// Schema-constrained output so the model returns exactly these fields (no prose
// to parse). Mirrors modelOutputSchema; the API enforces it server-side.
const NUTRITION_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      calories: { type: "number", description: "Total kcal for the whole described portion" },
      proteinG: { type: "number", description: "Total protein in grams" },
      carbsG: { type: "number", description: "Total carbohydrate in grams" },
      fatG: { type: "number", description: "Total fat in grams" },
    },
    required: ["calories", "proteinG", "carbsG", "fatG"],
    additionalProperties: false,
  },
};

const SYSTEM = [
  "You are a nutrition estimator for a calorie-tracking app.",
  "Given a free-text meal description and a portion, estimate the nutrition for the WHOLE portion described, with the quantity already included.",
  "Use realistic home-cooked values; West African and global dishes are common.",
  "Return only the structured fields; give your best estimate even when unsure.",
].join(" ");

function clamp(value: number, max: number): number {
  const v = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(max, Math.round(v)));
}

function buildPrompt(payload: EstimateFoodPayload): string {
  const lines = [`Food: ${payload.name.trim()}`];
  if (payload.ingredients) lines.push(`Ingredients: ${payload.ingredients.trim()}`);
  if (payload.cookingMethod) lines.push(`Cooking method: ${payload.cookingMethod.trim()}`);
  lines.push(`Portion: ${payload.quantity} ${payload.portionMeasure}`);
  return lines.join("\n");
}

/** One Claude call → validated, clamped nutrients for the whole portion. */
export async function estimateNutritionViaModel(payload: EstimateFoodPayload): Promise<Nutrients> {
  let raw: string;
  try {
    const message = await getAnthropic().messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: env.AI_ESTIMATE_MAX_TOKENS,
      system: SYSTEM,
      output_config: { format: NUTRITION_FORMAT },
      messages: [{ role: "user", content: buildPrompt(payload) }],
    });
    const block = message.content.find((b) => b.type === "text");
    raw = block && block.type === "text" ? block.text : "";
  } catch (err) {
    logger.error({ err }, "anthropic estimate call failed");
    throw new UpstreamError("Could not estimate nutrition right now");
  }

  let parsed: z.infer<typeof modelOutputSchema>;
  try {
    parsed = modelOutputSchema.parse(JSON.parse(raw));
  } catch (err) {
    logger.error({ err, raw }, "anthropic estimate returned unparseable output");
    throw new UpstreamError("Could not estimate nutrition right now");
  }

  return {
    calories: clamp(parsed.calories, MAX.calories),
    proteinG: clamp(parsed.proteinG, MAX.proteinG),
    carbsG: clamp(parsed.carbsG, MAX.carbsG),
    fatG: clamp(parsed.fatG, MAX.fatG),
  };
}
