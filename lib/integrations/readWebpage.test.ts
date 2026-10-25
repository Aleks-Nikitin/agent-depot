import { afterEach, expect, it, vi } from "vitest";
const search = vi.hoisted(() => vi.fn());
vi.mock("./serpapi", () => ({ serpapiSearch: search }));
import { readWebpage } from "./readWebpage";
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("reads the actual Extract API text_content envelope and keeps result size bounded", async () => {
  vi.stubEnv("SERPAPI_API_KEY", "test-only");
  search.mockResolvedValue({ data: { text_content: { full: "Full text", markdown: "M".repeat(5000) } }, cached: false });
  const result = await readWebpage.run({ url: "https://example.com/article" }) as { text: string; chars: number };
  expect(result.text).toHaveLength(4000); expect(result.chars).toBe(5000);
  expect(search).toHaveBeenCalledWith("extract", { url: "https://example.com/article", mode: "scrape", include_markdown: "true" }, undefined);
});
