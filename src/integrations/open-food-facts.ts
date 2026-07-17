import { createHash } from "node:crypto";
export interface OpenFoodFactsProduct {
  barcode: string | null;
  /** Stable OFF identity used when a result has no barcode. */
  externalId?: string | null;
  name: string;
  brand: string | null;
  /** Which reference amount every nutrient below is stated for (ADR-0022) — one basis for the whole product. */
  basis: "per_serving" | "per_100g";
  servingLabel: string;
  /** Grams for one reference serving. Always > 0 when basis is per_serving; may be a display-only hint otherwise. */
  servingGrams: number | null;
  nutrients: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
}

export interface OpenFoodFactsSearchResult {
  externalId: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  /** Carried through so search materialize can upsert without a second OFF fetch. */
  basis: OpenFoodFactsProduct["basis"];
  servingLabel: string;
  servingGrams: number | null;
  nutrients: OpenFoodFactsProduct["nutrients"];
  source: "openfoodfacts";
}

interface OffResponse {
  product?: {
    code?: string;
    _id?: string;
    id?: string;
    product_name?: string;
    product_name_en?: string;
    brands?: string;
    serving_size?: string;
    serving_quantity?: string | number;
    nutriments?: Record<string, string | number | undefined>;
  };
}

interface OffSearchResponse {
  products?: Array<NonNullable<OffResponse["product"]>>;
}

const OFF_ENDPOINT = "https://world.openfoodfacts.org/api/v3/product";
const OFF_SEARCH_ENDPOINT = "https://world.openfoodfacts.org/cgi/search.pl";
const OFF_TIMEOUT_MS = 4_000;
// Open Food Facts asks integrators to send a descriptive User-Agent identifying
// the app + a contact method; generic/default client UAs are known to get
// throttled — often silently (200 OK, empty product list).
export const OFF_USER_AGENT = "ThrivoApp/1.0 (+https://thrivo.fit; support@thrivo.fit)";
const SEARCH_FIELDS = [
  "code",
  "_id",
  "id",
  "product_name",
  "product_name_en",
  "brands",
  "serving_size",
  "serving_quantity",
  "nutriments",
].join(",");

export async function fetchOpenFoodFactsProduct(
  barcode: string
): Promise<OpenFoodFactsProduct | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
  try {
    const res = await fetch(`${OFF_ENDPOINT}/${encodeURIComponent(barcode)}.json`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": OFF_USER_AGENT },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Open Food Facts lookup failed with ${res.status}`);
    const body = (await res.json()) as OffResponse;
    if (!body.product) return null;
    return normalizeProduct(barcode, body.product);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Open Food Facts lookup timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchOpenFoodFactsProducts(
  query: string,
  limit: number,
  page = 1
): Promise<OpenFoodFactsSearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      search_terms: query,
      search_simple: "1",
      action: "process",
      json: "1",
      page_size: String(limit),
      page: String(Math.max(1, page)),
      fields: SEARCH_FIELDS,
    });
    const res = await fetch(`${OFF_SEARCH_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": OFF_USER_AGENT },
    });
    if (!res.ok) throw new Error(`Open Food Facts search failed with ${res.status}`);
    const body = (await res.json()) as OffSearchResponse;
    const products = body.products ?? [];
    const seen = new Set<string>();
    const results: OpenFoodFactsSearchResult[] = [];
    for (const product of products) {
      const normalized = normalizeSearchResult(product);
      if (!normalized || seen.has(normalized.externalId)) continue;
      seen.add(normalized.externalId);
      results.push(normalized);
    }
    return results;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Open Food Facts search timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const SERVING_NUTRIENT_KEYS = [
  "energy-kcal_serving",
  "proteins_serving",
  "carbohydrates_serving",
  "fat_serving",
] as const;
const PER_100G_NUTRIENT_KEYS = [
  "energy-kcal_100g",
  "proteins_100g",
  "carbohydrates_100g",
  "fat_100g",
] as const;

/**
 * ADR-0022 (D1) — one basis for the WHOLE product, never per-nutrient. OFF
 * reports every macro on both a `*_serving` and `*_100g` key independently, and
 * either can be missing per-nutrient; picking a basis per-nutrient (the old
 * behavior) let a product be stored `per_serving` while its protein/carbs/fat
 * were silently sourced from `*_100g` — the multiplier then scales numbers that
 * were never on that basis. Precedence: a complete `*_serving` set (+ a usable
 * `serving_quantity`) wins; else a complete `*_100g` set; else the product is
 * rejected as incomplete rather than guessed at.
 */
function normalizeProduct(
  barcode: string | null,
  product: NonNullable<OffResponse["product"]>
): OpenFoodFactsProduct | null {
  const name = clean(product.product_name_en ?? product.product_name);
  if (!name) return null;
  const nutriments = product.nutriments ?? {};
  const servingGrams = toNumber(product.serving_quantity);
  const servingLabel =
    clean(product.serving_size) ?? (servingGrams ? `${servingGrams}g` : "serving");
  const brand = clean(product.brands);

  const perServing =
    servingGrams && servingGrams > 0 ? allNumbers(nutriments, SERVING_NUTRIENT_KEYS) : null;
  if (perServing) {
    return {
      barcode,
      name,
      brand,
      basis: "per_serving",
      servingLabel,
      servingGrams,
      nutrients: {
        calories: perServing[0],
        proteinG: perServing[1],
        carbsG: perServing[2],
        fatG: perServing[3],
      },
    };
  }

  const per100g = allNumbers(nutriments, PER_100G_NUTRIENT_KEYS);
  if (per100g) {
    return {
      barcode,
      name,
      brand,
      basis: "per_100g",
      servingLabel,
      // Kept only as a display hint (e.g. "1 bar (40g)") — never a basis divisor here.
      servingGrams,
      nutrients: {
        calories: per100g[0],
        proteinG: per100g[1],
        carbsG: per100g[2],
        fatG: per100g[3],
      },
    };
  }

  return null;
}

function normalizeSearchResult(
  product: NonNullable<OffResponse["product"]>
): OpenFoodFactsSearchResult | null {
  const code = clean(product.code);
  const name = clean(product.product_name_en ?? product.product_name);
  if (!name) return null;
  const normalized = normalizeProduct(code, product);
  if (!normalized) return null;
  const stableKey = JSON.stringify({
    name: normalized.name,
    brand: normalized.brand,
    servingLabel: normalized.servingLabel,
    servingGrams: normalized.servingGrams,
  });
  const externalId = code
    ? "off:" + code
    : "off:hash:" + createHash("sha256").update(stableKey).digest("hex").slice(0, 32);
  return {
    externalId,
    name: normalized.name,
    brand: normalized.brand,
    barcode: code,
    basis: normalized.basis,
    servingLabel: normalized.servingLabel,
    servingGrams: normalized.servingGrams,
    nutrients: normalized.nutrients,
    source: "openfoodfacts",
  };
}
/** Returns the parsed numbers for `keys`, in order, only if every one resolves — else null. */
function allNumbers(
  values: Record<string, string | number | undefined>,
  keys: readonly string[]
): number[] | null {
  const nums: number[] = [];
  for (const key of keys) {
    const value = toNumber(values[key]);
    if (value === null) return null;
    nums.push(value);
  }
  return nums;
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
