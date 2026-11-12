import { z } from "zod";
import { products } from "@/lib/integrations/data/products";
import { KnowledgeSourceSchema } from "@/lib/knowledge/contracts";

export const EvaluationFixturesSchema = z.object({
  tickets: z.array(z.object({ id: z.string().min(1).max(100), subject: z.string().trim().min(1).max(200), idempotencyKey: z.string().min(1).max(200) }).strict()).max(100).default([]),
  orders: z.array(z.object({ id: z.string().min(1).max(100), orderId: z.string().min(1).max(100), status: z.string().min(1).max(50), totalCents: z.number().int().nonnegative(), currency: z.string().length(3) }).strict()).max(100)
    .default([{ id: "fixture-order-1042", orderId: "1042", status: "delivered", totalCents: 4900, currency: "USD" }]),
  knowledge: z.object({ documents: z.array(KnowledgeSourceSchema).max(100), sample: z.boolean() }).strict(),
  products: z.array(z.object({ id: z.string(), name: z.string(), category: z.string(), price: z.number().nonnegative(), unitsSold: z.number().int().nonnegative() }).strict()).max(100).default(() => structuredClone(products)),
}).strict();
export type EvaluationFixtures = z.infer<typeof EvaluationFixturesSchema>;

/** Case-authored fixture overrides; omitted knowledge uses the suite snapshot. */
export const EvaluationSeedSchema = EvaluationFixturesSchema.partial();
export type EvaluationSeed = z.infer<typeof EvaluationSeedSchema>;
