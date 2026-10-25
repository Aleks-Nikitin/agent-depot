import { afterEach, expect, it, vi } from "vitest";
vi.mock("./serpapi", () => ({ serpapiSearch: vi.fn() }));
import { serpapiSearch } from "./serpapi";
import { googleShopping } from "./googleShopping";
import { googleNews } from "./googleNews";
import { readWebpage } from "./readWebpage";
const search = vi.mocked(serpapiSearch);
afterEach(() => vi.resetAllMocks());
it.each([googleShopping, googleNews, readWebpage])("preserves setup/quota errors from $id instead of hiding the cause", async tool => {
  const input = tool.id === "read_webpage" ? { url: "https://public.example.test/page" } : { query: "test non-fixture query" };
  for (const code of ["search_not_configured", "search_rate_limited", "search_access_denied"]) {
    search.mockResolvedValue({ data: { error: code }, cached: false, source: "error" });
    expect(await tool.run(input)).toEqual({ error: code });
  }
});
it("keeps the real shopping product link and an explicit empty result", async () => {
  search.mockResolvedValue({ data: { shopping_results: [{ title: "Protein 2lb", price: "$49", source: "Seller", product_link: "https://shop.example.test/product" }] }, cached: false, source: "serpapi" });
  expect(await googleShopping.run({ query: "protein 2lb" })).toMatchObject({ count: 1, results: [{ link: "https://shop.example.test/product", price: "$49" }] });
  search.mockResolvedValue({ data: { shopping_results: [] }, cached: false, source: "serpapi" });
  expect(await googleShopping.run({ query: "missing" })).toMatchObject({ count: 0, results: [] });
});
