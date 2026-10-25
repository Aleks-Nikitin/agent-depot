import "dotenv/config";
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db/prisma";
import { demoRegistry } from "../../integrations/demo-tools";
import { supportAgent } from "../fixtures";
import { dispatchTool } from "./registry";

it("makes repeated approved demo ticket calls idempotent in PostgreSQL", async () => {
  const db = getDb();
  const idempotencyKey = `test-${randomUUID()}`;
  const options = { config: supportAgent, registry: demoRegistry, toolId: "create_ticket", input: { subject: "Disposable test ticket" }, writeApproved: true,
    context: { ownerId: "demo", runId: "test", toolCallId: "test", idempotencyKey, signal: new AbortController().signal } };
  try {
    const [first, second] = await Promise.all([dispatchTool(options), dispatchTool(options)]);
    expect(first).toEqual(second);
    expect(await db.demoTicket.count({ where: { idempotencyKey } })).toBe(1);
    await expect(dispatchTool({ ...options, input: { subject: "Different arguments" } })).rejects.toThrow("idempotency_conflict");
  } finally {
    await db.demoTicket.deleteMany({ where: { idempotencyKey } });
    await db.$disconnect();
  }
});
