import { newsFixtures } from "./data/fixtures";
import { z } from "zod";
import { serpapiSearch } from "./serpapi";
import type { Tool } from "./types"; 

const Input = z.object({ query: z.string() });

export const googleNews: Tool = {
  id: "google_news",
  description: "Get recent news about a company or product.",
  input: Input,
  kind: "read",
  run: async (args) => {
    try {
      const { query } = Input.parse(args);
      const fixture = newsFixtures[query.toLowerCase()];
      if (fixture) {
        return { source: "google_news", cached: true, query, results: fixture };
      }
      const { data, cached } = await serpapiSearch("google_news", { q: query });
      const results = (data as any)?.news_results ?? [];
      return {
        source: "google_news",
        cached,
        query,
        results: results.slice(0, 5).map((r: any) => ({
          title: r.title,
          snippet: r.snippet,
          date: r.date,
          link: r.link,
        })),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "google_news failed" };
    }
  },
};