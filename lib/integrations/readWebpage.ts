import { webpageFixtures } from "./data/fixtures";
import { z } from "zod";
import { serpapiSearch } from "./serpapi";
import type { Tool } from "./types"; // ← USE YOUR LINE

const Input = z.object({ url: z.string().url() });

export const readWebpage: Tool = {
  id: "read_webpage",
  description: "Read the full text of a webpage.",
  input: Input,
  kind: "read",
  run: async (args) => {
    try {
      const { url } = Input.parse(args);
      const fixture = webpageFixtures[url];
      if (fixture) {
        return { source: "read_webpage", cached: true, url, chars: fixture.length, text: fixture };
      }
      const { data, cached } = await serpapiSearch("extract", { url });
      const text =
        (data as any)?.text ?? (data as any)?.content ?? (data as any)?.extract ?? "";
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