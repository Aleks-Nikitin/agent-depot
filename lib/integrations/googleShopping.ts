import { shoppingFixtures } from "./data/fixtures";
import { z } from "zod";
import { serpapiSearch } from "./serpapi";
import type { Tool } from "./types"; // ← USE YOUR LINE

const Input = z.object({ query: z.string() });

export const googleShopping: Tool = {
  id: "google_shopping",
  description: "Find competitor prices for a product using Google Shopping.",
  input: Input,
  kind: "read",
  run: async (args) => {
    try {
      const { query } = Input.parse(args);
      const fixture = shoppingFixtures[query.toLowerCase()];
      if (fixture) {
        return { source: "google_shopping", cached: true, query, count: fixture.length, results: fixture };
      }
      const { data, cached } = await serpapiSearch("google_shopping", { q: query });
      const results = (data as any)?.shopping_results ?? [];
      return {
        source: "google_shopping",
        cached,
        query,
        count: Math.min(results.length, 5),
        results: results.slice(0, 5).map((r: any) => ({
          title: r.title,
          price: r.price,
          seller: r.source,
          link: r.link,
        })),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "google_shopping failed" };
    }
  },
};