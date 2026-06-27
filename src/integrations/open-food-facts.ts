export interface OpenFoodFactsProduct {
  barcode: string;
  name: string;
  brand: string | null;
  servingLabel: string;
  servingGrams: number | null;
  nutrients: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
}

interface OffResponse {
  status?: number;
  product?: {
    code?: string;
    product_name?: string;
    product_name_en?: string;
    brands?: string;
    serving_size?: string;
    serving_quantity?: string | number;
    nutriments?: Record<string, string | number | undefined>;
  };
}

const OFF_ENDPOINT = "https://world.openfoodfacts.org/api/v3/product";
const OFF_TIMEOUT_MS = 4_000;

export async function fetchOpenFoodFactsProduct(
  barcode: string
): Promise<OpenFoodFactsProduct | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
  try {
    const res = await fetch(`${OFF_ENDPOINT}/${encodeURIComponent(barcode)}.json`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as OffResponse;
    if (body.status !== 1 || !body.product) return null;
    return normalizeProduct(barcode, body.product);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeProduct(
  barcode: string,
  product: NonNullable<OffResponse["product"]>
): OpenFoodFactsProduct | null {
  const name = clean(product.product_name_en ?? product.product_name);
  if (!name) return null;
  const nutriments = product.nutriments ?? {};
  const servingGrams = toNumber(product.serving_quantity);
  return {
    barcode,
    name,
    brand: clean(product.brands),
    servingLabel: clean(product.serving_size) ?? (servingGrams ? `${servingGrams}g` : "serving"),
    servingGrams,
    nutrients: {
      calories: firstNumber(nutriments, ["energy-kcal_serving", "energy-kcal_100g"]) ?? 0,
      proteinG: firstNumber(nutriments, ["proteins_serving", "proteins_100g"]) ?? 0,
      carbsG: firstNumber(nutriments, ["carbohydrates_serving", "carbohydrates_100g"]) ?? 0,
      fatG: firstNumber(nutriments, ["fat_serving", "fat_100g"]) ?? 0,
    },
  };
}

function firstNumber(values: Record<string, string | number | undefined>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(values[key]);
    if (value !== null) return value;
  }
  return null;
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
