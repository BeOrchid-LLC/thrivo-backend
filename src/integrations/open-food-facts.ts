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

export interface OpenFoodFactsSearchResult {
  externalId: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  servingLabel: string;
  servingGrams: number | null;
  nutrients: OpenFoodFactsProduct["nutrients"];
  source: "openfoodfacts";
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
    if (!res.ok) throw new Error(`Open Food Facts lookup failed with ${res.status}`);
    const body = (await res.json()) as OffResponse;
    if (body.status !== 1 || !body.product) return null;
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
  limit: number
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

function normalizeSearchResult(
  product: NonNullable<OffResponse["product"]>
): OpenFoodFactsSearchResult | null {
  const code = clean(product.code);
  const name = clean(product.product_name_en ?? product.product_name);
  if (!code || !name) return null;
  const normalized = normalizeProduct(code, product);
  if (!normalized) return null;
  return {
    externalId: `off:${code}`,
    name: normalized.name,
    brand: normalized.brand,
    barcode: normalized.barcode,
    servingLabel: normalized.servingLabel,
    servingGrams: normalized.servingGrams,
    nutrients: normalized.nutrients,
    source: "openfoodfacts",
  };
}

function firstNumber(
  values: Record<string, string | number | undefined>,
  keys: string[]
): number | null {
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
