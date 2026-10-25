import { createHash } from "crypto";
import { mkdir, readFile, writeFile, stat } from "fs/promises";
import path from "path";

const CACHE_DIR = path.join(process.cwd(), ".cache/serpapi");

function cacheKey(engine: string, params: Record<string, string>) {
  const raw = engine + ":" + JSON.stringify(params, Object.keys(params).sort());
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

async function readCache(key: string) {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (Date.now() - (await stat(file)).mtimeMs > 5 * 60_000) return null;
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: unknown) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data, null, 2));
  } catch {
    /* cache write failures must never break a run */
  }
}

export async function serpapiSearch(
  engine: string,
  params: Record<string, string>, signal?: AbortSignal
): Promise<{ data: unknown; cached: boolean; source: string }> {
  const key = cacheKey(engine, params);

  const hit = await readCache(key);
  if (hit) return { data: hit, cached: true, source: "cache" };

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return { data: { error: "search_not_configured" }, cached: false, source: "error" };
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", engine);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(res.status === 429 ? "search_rate_limited" : [401, 403].includes(res.status) ? "search_access_denied" : "search_unavailable");
    const json = await res.json();
    if (json && typeof json === "object" && "error" in json) return { data: { error: "search_unavailable" }, cached: false, source: "error" };
    await writeCache(key, json);
    return { data: json, cached: false, source: "serpapi" };
  } catch (e) {
    return {
      data: { error: e instanceof Error && ["search_rate_limited", "search_access_denied", "search_unavailable"].includes(e.message) ? e.message : "search_unavailable" },
      cached: false,
      source: "error",
    };
  }
}
