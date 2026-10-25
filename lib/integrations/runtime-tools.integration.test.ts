import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "../db/prisma";
import { supportAgent } from "../agents/fixtures";
import { runAgent, resumeAgent } from "../agents/runtime/run-agent";
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
  const other = await dispatchTool({ config: { ...config, ownerId: "another-owner" }, registry: runtimeRegistry,
    toolId: "knowledge_search", input: { query }, context: { ...context, ownerId: "another-owner" } });
  expect(other).toMatchObject({ matches: [] });
  const sales = await dispatchTool({ config, registry: runtimeRegistry, toolId: "sales_lookup", input: { query: "top 3 products" }, context });
  expect(sales).toHaveProperty("rows.length", 3);
});

it("pauses and resumes recorded email through the guarded engine, and never records evaluation writes", async () => {
  for (const evaluation of [false, true]) {
    let turn = 0;
    const driver: ModelDriver = { key: "integration-driver", estimate: () => 0.00001, turn: async () => ++turn === 1
      ? { text: "", messages: [], calls: [{ toolCallId: "email-1", toolId: "send_email", input: { to: "demo@example.test", subject: "Review", body: "Recorded demo only." } }], inputTokens: 1, outputTokens: 1 }
      : { text: "Done", messages: [], calls: [], inputTokens: 1, outputTokens: 1 } };
    const events: RunStep[] = [];
    const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver, onEvent: (event: RunStep) => { events.push(event); if (!runs.includes(event.runId)) runs.push(event.runId); } };
    let result = await runAgent({ config, ownerId, message: "Record an email", approvalMode: evaluation ? "deny" : "human" }, deps);
    expect(await db.recordedEmail.count({ where: { runId: result.runId } })).toBe(0);
    if (!evaluation) {
      expect(result.status).toBe("waiting_approval");
      const approval = events.find(event => event.type === "approval_required");
      if (approval?.type !== "approval_required") throw new Error("missing approval");
      result = await resumeAgent({ ownerId, approvalId: approval.payload.approvalId, approved: true }, deps);
      expect(await db.recordedEmail.count({ where: { runId: result.runId } })).toBe(1);
      await expect(resumeAgent({ ownerId, approvalId: approval.payload.approvalId, approved: true }, deps)).rejects.toThrow("approval_unavailable");
    }
    expect(result.status).toBe("completed");
    const saved = await db.agentRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(saved.source).toBe(evaluation ? "test" : "playground");
    expect(saved.agentVersion).toBe(config.version);
  }
});
