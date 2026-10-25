import { shoppingFixtures } from "./data/fixtures";
import { z } from "zod";
import { serpapiSearch } from "./serpapi";
import type { Tool } from "./types"; // ← USE YOUR LINE

const Input = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const Result = z.object({ title: z.string().optional(), price: z.string().optional(), source: z.string().optional(), link: z.string().optional() });

export const googleShopping: Tool = {
  id: "google_shopping",
  description: "Find competitor prices for a product using Google Shopping.",
  input: Input,
  kind: "read",
  run: async (args, context) => {
    try {
      const { query } = Input.parse(args);
      const fixture = shoppingFixtures[query.toLowerCase()];
      if (fixture && !process.env.SERPAPI_API_KEY) {
        return { source: "google_shopping", cached: true, demo: true, query, count: fixture.length, results: fixture };
      }
      const { data, cached } = await serpapiSearch("google_shopping", { q: query }, context?.signal);
      if (data && typeof data === "object" && "error" in data) throw new Error("search_unavailable");
      const results = z.object({ shopping_results: z.array(Result).default([]) }).parse(data).shopping_results;
      return {
        source: "google_shopping",
        cached,
        query,
        count: Math.min(results.length, 5),
        results: results.slice(0, 5).map(r => ({
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