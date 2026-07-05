import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

import {
  fetchOpenFoodFactsProduct,
  searchOpenFoodFactsProducts,
  OFF_USER_AGENT,
} from "../../src/integrations/open-food-facts";

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

describe("open food facts integration", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("sends a descriptive User-Agent header on barcode lookup", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 1, product: { code: "123", product_name: "Test" } })
    );
    await fetchOpenFoodFactsProduct("123");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["User-Agent"]).toBe(OFF_USER_AGENT);
  });

  it("sends a descriptive User-Agent header on search", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ products: [] }));
    await searchOpenFoodFactsProducts("chicken", 20);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["User-Agent"]).toBe(OFF_USER_AGENT);
  });

  it("returns an empty array (not throwing) when OFF has no matches", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ products: [] }));
    const results = await searchOpenFoodFactsProducts("zzzznonexistent", 20);
    expect(results).toEqual([]);
  });

  it("dedupes products by code and filters entries missing a name", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        products: [
          { code: "1", product_name: "A" },
          { code: "1", product_name: "A dup" },
          { code: "2" }, // no product_name -> filtered
        ],
      })
    );
    const results = await searchOpenFoodFactsProducts("a", 20);
    expect(results).toHaveLength(1);
    expect(results[0].externalId).toBe("off:1");
  });
});
