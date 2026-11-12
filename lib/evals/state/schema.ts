import { z } from "zod";

const ticket = z.object({ id: z.string(), ownerId: z.string(), idempotencyKey: z.string(), subject: z.string() }).strict();
const order = z.object({ id: z.string(), ownerId: z.string(), orderId: z.string(), status: z.string(), totalCents: z.number().int().nonnegative(), currency: z.string() }).strict();
const knowledge = z.object({ id: z.string(), ownerId: z.string(), title: z.string(), text: z.string() }).strict();
export const StateSnapshotSchema = z.object({ tickets: z.array(ticket).max(200), orders: z.array(order).max(200), knowledge: z.array(knowledge).max(100) }).strict();
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;
const table = z.enum(["tickets", "orders", "knowledge"]);
const fields = z.record(z.string(), z.union([z.string().max(100_000), z.number().finite()])).refine(value => Object.keys(value).length <= 8, "Too many fields");
const schemas = { tickets: ticket, orders: order, knowledge };
export const StateAssertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count"), table, where: fields.optional(), equals: z.number().int().min(0).max(200) }).strict(),
  z.object({ kind: z.literal("record"), table, where: fields.optional(), fields, count: z.number().int().min(1).max(200).default(1) }).strict(),
  z.object({ kind: z.literal("unchanged"), table, where: fields.optional() }).strict(),
]).superRefine((assertion, ctx) => {
  for (const [group, values] of Object.entries({ where: assertion.where, fields: "fields" in assertion ? assertion.fields : undefined })) {
    for (const [key, value] of Object.entries(values ?? {})) {
      const shape = schemas[assertion.table].shape;
      if (!Object.hasOwn(shape, key) || !(shape[key as keyof typeof shape] as z.ZodType).safeParse(value).success) ctx.addIssue({ code: "custom", path: [group, key], message: "Unknown field or invalid value for this collection" });
    }
  }
});
export const StateAssertionsSchema = z.array(StateAssertionSchema).max(20);
export type StateAssertion = z.infer<typeof StateAssertionSchema>;
