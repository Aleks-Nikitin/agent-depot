import { webpageFixtures } from "./data/fixtures";
import { z } from "zod";
import { serpapiSearch } from "./serpapi";
import type { Tool } from "./types"; // ← USE YOUR LINE

const Input = z.object({ url: z.httpUrl().max(2048).refine(value => { const url = new URL(value); return !url.username && !url.password; }) }).strict();

export const readWebpage: Tool = {
  id: "read_webpage",
  description: "Extract up to 4000 characters from a public webpage using SerpApi. Requires search configuration.",
  input: Input,
  kind: "read",
  run: async (args, context) => {
    try {
      const { url } = Input.parse(args);
      const fixture = webpageFixtures[url];
      if (fixture && !process.env.SERPAPI_API_KEY) {
        return { source: "read_webpage", cached: true, demo: true, url, chars: fixture.length, text: fixture };
      }
      const { data, cached } = await serpapiSearch("extract", { url, mode: "scrape", include_markdown: "true" }, context?.signal);
      if (data && typeof data === "object" && "error" in data) throw new Error(String(data.error));
      const parsed =
        z.object({ text_content: z.object({ full: z.string().optional(), markdown: z.string().optional() }) }).parse(data);
      const text = parsed.text_content.markdown ?? parsed.text_content.full;
      if (!text) throw new Error("webpage_unavailable");
      return {
        source: "read_webpage",
        cached,
        url,
        chars: String(text).length,
        text: String(text).slice(0, 4000),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "read_webpage failed" };
    }
  },
};
