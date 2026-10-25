import { z } from "zod";
import type { Tool } from "./types";

const input = z
  .object({
    query: z.string().trim().min(1).max(200),
  })
  .strict();

export const googleNews: Tool = {
  id: "google_news",
  description: "Fetch recent news headlines related to retail and apparel.",
  input,
  kind: "read",
  async run(args) {
    const { query } = input.parse(args);
    return {
      source: "google_news_sample",
      query,
      articles: [
        {
          title: "Layering season lifts mid-price outerwear sales",
          source: "Retail Dispatch",
          publishedAt: "2026-10-18T09:15:00Z",
          snippet:
            "Specialty apparel chains reported stronger jacket sell-through as shoppers looked for canvas and nylon shells under $150.",
          url: "https://news.example.com/retail/outerwear-sell-through",
        },
        {
          title: "Return windows remain a loyalty differentiator",
          source: "Shopper Insights Daily",
          publishedAt: "2026-10-12T14:02:00Z",
          snippet:
            "Stores advertising a clear 30-day returns policy on outerwear saw fewer cart abandonments during promotional weekends.",
          url: "https://news.example.com/retail/return-windows",
        },
      ],
    };
  },
};
