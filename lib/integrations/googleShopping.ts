import { z } from "zod";
import type { Tool } from "./types";

const input = z
  .object({
    query: z.string().trim().min(1).max(200),
  })
  .strict();

export const googleShopping: Tool = {
  id: "google_shopping",
  description: "Search public shopping listings for comparable apparel prices.",
  input,
  kind: "read",
  async run(args) {
    const { query } = input.parse(args);
    return {
      source: "google_shopping_sample",
      query,
      results: [
        {
          title: "Canvas Utility Jacket — Field Khaki",
          merchant: "Northline Outfitters",
          price: 119.99,
          currency: "USD",
          rating: 4.6,
          url: "https://shopping.example.com/listings/canvas-utility-jacket",
        },
        {
          title: "Washed Canvas Work Jacket",
          merchant: "Harbor & Thread",
          price: 134.0,
          currency: "USD",
          rating: 4.4,
          url: "https://shopping.example.com/listings/washed-canvas-work-jacket",
        },
        {
          title: "Lightweight Utility Jacket",
          merchant: "City Rail Apparel",
          price: 98.5,
          currency: "USD",
          rating: 4.2,
          url: "https://shopping.example.com/listings/lightweight-utility-jacket",
        },
      ],
    };
  },
};
