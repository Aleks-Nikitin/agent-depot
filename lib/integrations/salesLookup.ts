import { z } from "zod";
import { getProducts } from "./store";
import type { Product, Tool } from "./types";

const input = z
  .object({
    query: z.union([z.string(), z.number()]).optional(),
    category: z.string().optional(),
    q: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

type SalesRow = { name: string; category: string; price: number; unitsSold: number };

function toRow(product: Product): SalesRow {
  return {
    name: product.name,
    category: product.category,
    price: product.price,
    unitsSold: product.unitsSold,
  };
}

function byUnitsSold(a: Product, b: Product) {
  return b.unitsSold - a.unitsSold;
}

function topN(catalog: Product[], n = 5): Product[] {
  return [...catalog].sort(byUnitsSold).slice(0, Math.min(Math.max(1, n), catalog.length || 1));
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function readQuery(args: unknown): { query: string; category: string } {
  if (typeof args === "string" || typeof args === "number") {
    return { query: asText(args), category: "" };
  }
  const parsed = input.safeParse(args ?? {});
  const data = parsed.success ? parsed.data : (args as Record<string, unknown> | null);
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    query: asText(record.query ?? record.q ?? record.text ?? record.prompt),
    category: asText(record.category),
  };
}

function mentionsRanking(query: string): boolean {
  return /(?:^|[^a-z])(?:top|best|most|selling)(?:[^a-z]|$)/i.test(query);
}

function limitFromQuery(query: string): number {
  const match = query.match(/(?:top|best|most)\s+(\d+)/i);
  if (match) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 20);
  }
  return 5;
}

function namedCategory(catalog: Product[], query: string, explicit: string): string | null {
  const categories = [...new Set(catalog.map((product) => product.category.toLowerCase()))].sort(
    (a, b) => b.length - a.length,
  );
  if (explicit) {
    const needle = explicit.toLowerCase();
    if (categories.includes(needle)) return needle;
  }
  const lower = ` ${query.toLowerCase()} `;
  for (const category of categories) {
    if (lower.includes(` ${category} `) || lower.includes(` ${category}s `)) return category;
  }
  return null;
}

function fuzzyNameMatch(catalog: Product[], query: string): Product[] {
  const lower = query.toLowerCase();
  const words = lower.split(/\W+/).filter((word) => word.length > 2);
  return catalog
    .map((product) => {
      const name = product.name.toLowerCase();
      if (name.includes(lower) && lower.length > 0) return { product, score: 80 };
      const hits = words.filter((word) => name.includes(word)).length;
      return { product, score: hits };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.product.unitsSold - a.product.unitsSold)
    .map((entry) => entry.product);
}

export const salesLookup: Tool = {
  id: "sales_lookup",
  description: "Look up AcmeStore product names, categories, prices, and units sold.",
  input,
  kind: "read",
  async run(args) {
    const { query, category } = readQuery(args);
    const catalog = getProducts();
    const fallback = topN(catalog, 5);
    const n = limitFromQuery(query);
    const categoryName = namedCategory(catalog, query, category);
    const scoped = categoryName
      ? catalog.filter((product) => product.category.toLowerCase() === categoryName)
      : catalog;

    let matches: Product[] = [];
    if (mentionsRanking(query)) {
      matches = topN(scoped, n);
    } else {
      if (query) matches = fuzzyNameMatch(scoped, query);
      if (matches.length === 0 && categoryName) matches = topN(scoped, Math.max(n, scoped.length));
    }

    if (matches.length === 0) matches = fallback;
    if (matches.length === 0) matches = topN(catalog, 5);

    const rows = matches.map(toRow);
    return {
      source: "acme_sales",
      currency: "USD",
      count: rows.length,
      query: query || null,
      category: categoryName,
      rows: rows.length > 0 ? rows : fallback.map(toRow),
    };
  },
};
