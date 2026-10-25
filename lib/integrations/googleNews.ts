import { newsFixtures } from "./data/fixtures";
import { z } from "zod";
import { serpapiSearch } from "./serpapi";
import type { Tool } from "./types"; 

const Input = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const Result = z.object({ title: z.string().optional(), snippet: z.string().optional(), date: z.string().optional(), link: z.string().optional() });

export const googleNews: Tool = {
  id: "google_news",
  description: "Get recent news about a company or product.",
  input: Input,
  kind: "read",
  run: async (args, context) => {
    try {
      const { query } = Input.parse(args);
      const fixture = newsFixtures[query.toLowerCase()];
      if (fixture && !process.env.SERPAPI_API_KEY) {
        return { source: "google_news", cached: true, demo: true, query, results: fixture };
      }
      const { data, cached } = await serpapiSearch("google_news", { q: query }, context?.signal);
      if (data && typeof data === "object" && "error" in data) throw new Error("search_unavailable");
      const results = z.object({ news_results: z.array(Result).default([]) }).parse(data).news_results;
      return {
        source: "google_news",
        cached,
        query,
        results: results.slice(0, 5).map(r => ({
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