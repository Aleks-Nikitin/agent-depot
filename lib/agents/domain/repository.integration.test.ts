import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { databaseConnectionSummary } from "@/lib/db/connection";
import { getDb } from "@/lib/db/prisma";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import { supportAgent } from "../fixtures";
import { dispatchTool } from "../tools/registry";
import { liveDomainRepository } from "./prisma-repository";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
it("scopes domain tools to the injected owner and never falls back to global data", async () => {
  const db = getDb();
  const ownerId = `domain-it-${randomUUID()}`;
  const other = `${ownerId}-other`;
  const context = { domain: liveDomainRepository(ownerId), ownerId, runId: "domain-it", toolCallId: "ticket", idempotencyKey: randomUUID(), signal: AbortSignal.timeout(10_000) };
  const config = { ...supportAgent, ownerId, enabledTools: ["create_ticket", "knowledge_search", "order_lookup"] };
  const call = (toolId: string, input: unknown) => dispatchTool({ config, registry: runtimeRegistry, context, toolId, input, writeApproved: true });
  try {
    await db.workspaceOrder.create({ data: { ownerId: other, orderId: "1042", status: "shipped", totalCents: 1200 } });
    expect(await call("order_lookup", { orderId: "1042" })).toEqual({ order: null });
    await db.workspaceOrder.create({ data: { ownerId, orderId: "1042", status: "pending", totalCents: 900 } });
    expect(await call("order_lookup", { orderId: "1042" })).toMatchObject({ order: { status: "pending", totalCents: 900 } });
    const [first, second] = await Promise.all([call("create_ticket", { subject: "Review 1042" }), call("create_ticket", { subject: "Review 1042" })]);
    expect(first).toEqual(second);
    expect(await db.demoTicket.count({ where: { ownerId } })).toBe(1);
    await expect(dispatchTool({ config, registry: runtimeRegistry, context: { ...context, domain: undefined }, toolId: "knowledge_search", input: { query: "returns" } })).rejects.toThrow("domain_scope_required");
    await expect(dispatchTool({ config, registry: runtimeRegistry, context: { ...context, domain: liveDomainRepository(other) }, toolId: "create_ticket", input: { subject: "Wrong owner" }, writeApproved: true })).rejects.toThrow("domain_owner_mismatch");
  } finally {
    await db.demoTicket.deleteMany({ where: { ownerId } });
    await db.workspaceOrder.deleteMany({ where: { ownerId: { in: [ownerId, other] } } });
    await db.$disconnect();
  }
});
