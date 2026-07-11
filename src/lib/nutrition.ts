// Pure nutrition-scaling math (ADR-0022). No I/O — the one place that turns a
// stored reference amount (basis + optional servingG) and a chosen quantity
// into logged kcal/macros, so every call site shares the same arithmetic
// instead of re-deriving it (and re-introducing I1/I2-shaped bugs).
import { ValidationError } from "./errors";
import { roundKcal, roundMacroG } from "./units";

/**
 * Reserved serving-option id for "the user entered a gram amount directly"
 * (buildServingOptions' synthetic weight-unit entry). Distinct from `null`,
 * which means "no explicit serving — use the item's own reference amount."
 * A plain string satisfies the contract's `idSchema` with no schema change.
 */
export const GRAMS_SERVING_ID = "grams";

export type SupportedNutrientBasis = "per_100g" | "per_serving";

export interface NutritionBasis {
  basis: SupportedNutrientBasis;
  /** Grams for one reference serving. Required (>0) when basis is per_serving. */
  servingG: number | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface QuantitySelection {
  /** `null` = no explicit serving chosen; GRAMS_SERVING_ID = raw grams entry. */
  servingId: string | null;
  /** Servings count, or grams when servingId === GRAMS_SERVING_ID. */
  quantity: number;
  /** Gram weight of the matched named `food_servings` row, when servingId is a real id. */
  matchedServingGrams?: number | null;
}

/**
 * Total grams the logged quantity resolves to. Never falls through to a bare
 * multiplier of 1×quantity — a reference amount that can't be established is a
 * validation error (D2), not a silent guess.
 */
export function resolveQuantityGrams(selection: QuantitySelection, basis: NutritionBasis): number {
  if (selection.quantity <= 0) {
    throw new ValidationError("Quantity must be positive");
  }

  if (selection.servingId === GRAMS_SERVING_ID) {
    return selection.quantity;
  }

  if (selection.servingId !== null) {
    const grams = selection.matchedServingGrams;
    if (!grams || grams <= 0) {
      throw new ValidationError("Selected serving no longer has a gram weight");
    }
    return selection.quantity * grams;
  }

  const referenceGrams = defaultReferenceGrams(basis);
  return selection.quantity * referenceGrams;
}

/** The reference amount (in grams) that `basis.kcal`/macros are stated for. */
function defaultReferenceGrams(basis: NutritionBasis): number {
  if (basis.basis === "per_serving") {
    if (!basis.servingG || basis.servingG <= 0) {
      throw new ValidationError("Food is missing a reference serving size");
    }
    return basis.servingG;
  }
  return 100;
}

/** Scales `quantityGrams` against the stored reference amount. */
export function nutrientMultiplier(quantityGrams: number, basis: NutritionBasis): number {
  return quantityGrams / defaultReferenceGrams(basis);
}

export interface ScaledNutrients {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function scaleNutrients(basis: NutritionBasis, quantityGrams: number): ScaledNutrients {
  const factor = nutrientMultiplier(quantityGrams, basis);
  return {
    kcal: roundKcal(basis.kcal * factor),
    proteinG: roundMacroG(basis.proteinG * factor),
    carbsG: roundMacroG(basis.carbsG * factor),
    fatG: roundMacroG(basis.fatG * factor),
  };
}

/** Guards a DB-sourced `nutrient_basis` value down to the two bases this module supports. */
export function assertSupportedBasis(basis: string): SupportedNutrientBasis {
  if (basis === "per_100g" || basis === "per_serving") return basis;
  throw new ValidationError(`Unsupported nutrition basis: ${basis}`);
}
