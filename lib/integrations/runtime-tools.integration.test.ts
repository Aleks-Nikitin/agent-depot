import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "../db/prisma";
import { supportAgent } from "../agents/fixtures";
import { runAgent } from "../agents/runtime/run-agent";
import { PrismaRunStore } from "../agents/storage/prisma-store";
import type { ModelDriver } from "../agents/runtime/model";
import type { RunStep } from "../agents/contracts";
import { dispatchTool } from "../agents/tools/registry";
import { runtimeRegistry } from "./runtime-tools";

const db = getDb();
const ownerId = `tool-integration-${randomUUID()}`;
const runs: string[] = [];
const config = { ...supportAgent, ownerId, enabledTools: [...runtimeRegistry.keys()] };
const context = { ownerId, runId: "read-only", toolCallId: "read", idempotencyKey: "read", signal: AbortSignal.timeout(10_000) };
afterAll(async () => {
  await db.demoTicket.deleteMany({ where: { ownerId } });
  await db.knowledgeDocument.deleteMany({ where: { ownerId } });
  await db.agentRun.deleteMany({ where: { id: { in: runs } } });
  await db.$disconnect();
});

it("uses the shared registry and workspace knowledge without leaking another owner's documents", async () => {
  expect([...runtimeRegistry.keys()]).toEqual(expect.arrayContaining(["knowledge_search", "sales_lookup", "google_shopping", "google_news", "read_webpage", "send_email"]));
  const query = `zircon${randomUUID().replaceAll("-", "")}`;
  await db.knowledgeDocument.create({ data: { ownerId, title: "Private policy", text: `${query} customers get a replacement.` } });
  const own = await dispatchTool({ config, registry: runtimeRegistry, toolId: "knowledge_search", input: { query }, context });
  expect(own).toHaveProperty("matches.length", 1);
  expect(own).toMatchObject({ sample: false, dataKind: "workspace_documents" });
  const absent = await dispatchTool({ config, registry: runtimeRegistry, toolId: "knowledge_search", input: { query: "unused jackets returns" }, context });
  expect(absent).toMatchObject({ matches: [], sample: false });
  const other = await dispatchTool({ config: { ...config, ownerId: "another-owner" }, registry: runtimeRegistry,
    toolId: "knowledge_search", input: { query }, context: { ...context, ownerId: "another-owner" } });
  expect(other).toMatchObject({ matches: [] });
  const sales = await dispatchTool({ config, registry: runtimeRegistry, toolId: "sales_lookup", input: { query: "top 3 products" }, context });
  expect(sales).toHaveProperty("rows.length", 3);
});

it("creates an internal ticket immediately even for older review-enabled agents, but denies test writes", async () => {
  for (const evaluation of [false, true]) {
    let turn = 0;
    const driver: ModelDriver = { key: "ticket-immediate", estimate: () => 0.00001, turn: async () => ++turn === 1
      ? { text: "", messages: [], calls: [{ toolCallId: "ticket", toolId: "create_ticket", input: { subject: "Review order" } }], inputTokens: 1, outputTokens: 1 }
      : { text: evaluation ? "Not created" : "Created", messages: [], calls: [], inputTokens: 1, outputTokens: 1 } };
    const events: RunStep[] = [];
    const before = await db.demoTicket.count({ where: { ownerId } });
    const result = await runAgent({ config, ownerId, message: "Create a support ticket", approvalMode: evaluation ? "deny" : "human" }, {
      store: new PrismaRunStore(db), registry: runtimeRegistry, driver, onEvent: event => { events.push(event); if (!runs.includes(event.runId)) runs.push(event.runId); },
    });
    expect(result.status).toBe("completed");
    expect(events.some(event => event.type === "approval_required")).toBe(false);
    expect(await db.demoTicket.count({ where: { ownerId } })).toBe(before + (evaluation ? 0 : 1));
  }
});

it("retired email never executes, and write caps still stop repeated tickets", async () => {
  for (const id of ["send_email", "create_ticket"]) {
    let turn = 0;
    const result = await runAgent({ config: { ...config, limits: { ...config.limits, maxWriteCalls: 1 } }, ownerId, message: "test policy" }, {
      store: new PrismaRunStore(db), registry: runtimeRegistry,
      driver: { key: "retired-cap", estimate: () => 0.00001, turn: async () => ({ text: "", messages: [], calls: [{ toolId: id, toolCallId: `c${++turn}`, input: id === "send_email" ? {} : { subject: "Review" } }], inputTokens: 1, outputTokens: 1 }) },
      onEvent: event => { if (!runs.includes(event.runId)) runs.push(event.runId); },
    });
    expect(result).toMatchObject(id === "send_email" ? { status: "failed", stopReason: "email_removed" } : { status: "blocked", stopReason: "write_limit" });
    expect(await db.recordedEmail.count({ where: { runId: result.runId } })).toBe(0);
  }
});
