// Pure unit + rounding helpers. The DB stores canonical SI (kg, cm) and ml; the
// edge converts. No I/O — trivially unit-testable.

const LB_PER_KG = 2.2046226218;
const CM_PER_IN = 2.54;
const ML_PER_FL_OZ = 29.5735295625;
const ML_PER_CUP = 240;

export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const inToCm = (inches: number): number => inches * CM_PER_IN;
export const cmToIn = (cm: number): number => cm / CM_PER_IN;
export const flOzToMl = (oz: number): number => oz * ML_PER_FL_OZ;
export const mlToFlOz = (ml: number): number => ml / ML_PER_FL_OZ;
export const cupsToMl = (cups: number): number => cups * ML_PER_CUP;
export const mlToCups = (ml: number): number => ml / ML_PER_CUP;

/** Round to `decimals` places, avoiding the classic 1.005 float error. */
export const round = (value: number, decimals = 0): number => {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
};

export const roundKcal = (kcal: number): number => Math.round(kcal);
export const roundMacroG = (grams: number): number => round(grams, 1);

/** Coerce a number into a `numeric(5,1)`-safe string for Postgres numeric columns. */
export const toNumeric1 = (value: number): string => round(value, 1).toFixed(1);
