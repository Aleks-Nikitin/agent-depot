import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { databaseUrl, databaseConnectionSummary } from "../../db/connection";
import { getDb } from "../../db/prisma";
import { PrismaRunStore } from "../storage/prisma-store";
import { createRegistry } from "../tools/registry";
import { supportAgent } from "../fixtures";
import { runAgent, resumeAgent } from "./run-agent";
import type { ModelDriver, ModelTurn } from "./model";
import type { AgentConfig, RunStep } from "../contracts";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb();
const store = new PrismaRunStore(db);
const ownerId = `recovery-${randomUUID()}`;
const runs: string[] = [];
const savers: PostgresSaver[] = [];
async function saver() {
  const value = PostgresSaver.fromConnString(databaseUrl()!, { schema: "langgraph_checkpoints" });
  savers.push(value); await value.setup(); return value;
}
afterAll(async () => {
  for (const id of runs) await savers[0]?.deleteThread(id);
  await db.demoTicket.deleteMany({ where: { ownerId } });
  await db.agentRun.deleteMany({ where: { id: { in: runs } } });
  await Promise.all(savers.map(s => s.end())); await db.$disconnect();
});
function answer(): ModelTurn {
  return { text: "Ticket created", calls: [], messages: [{ role: "assistant", content: "Ticket created" }], inputTokens: 10, outputTokens: 5 };
}
function ticket(): ModelTurn {
  return { ...answer(), text: "", calls: [{ toolId: "create_ticket", toolCallId: "ticket", input: { subject: "Original" } }],
    messages: [{ role: "assistant", content: [{ type: "tool-call", toolName: "create_ticket", toolCallId: "ticket", input: { subject: "Original" } }] }] };
}
function driver(turns: (ModelTurn | Error)[], key = "primary"): ModelDriver {
  return { key, estimate: (i, o) => (i + o) / 1_000_000,
    turn: vi.fn(async () => { const next = turns.shift(); if (next instanceof Error) throw next; if (!next) throw new Error("unexpected_call"); return next; }) };
}
async function fixture(model: ModelDriver, reviewed = false) {
  const checkpoint = await saver();
  const write = vi.fn(async (input: unknown, context: { idempotencyKey: string }) => {
    await db.demoTicket.createMany({ data: [{ ownerId, idempotencyKey: context.idempotencyKey, subject: (input as { subject: string }).subject }], skipDuplicates: true });
    return db.demoTicket.findUniqueOrThrow({ where: { idempotencyKey: context.idempotencyKey } }).then(row => ({ id: row.id }));
  });
  const registry = createRegistry([{ id: "create_ticket", description: "Create a workspace ticket", kind: "write",
    inputSchema: z.object({ subject: z.string(), priority: z.string().default("normal") }),
    automaticWrites: !reviewed, approvalExempt: !reviewed, run: write }]);
  const events: RunStep[] = [];
  const config: AgentConfig = { ...supportAgent, ownerId, id: `agent-${randomUUID()}`, enabledTools: ["create_ticket"] };
  const deps = { store, registry, driver: model, checkpointer: async () => checkpoint, onEvent: (event: RunStep) => {
    events.push(event); if (event.type === "run_started") runs.push(event.runId);
  } };
  return { config, deps, events, write };
}
it("binds approval to normalized arguments, rejects tampering, and resumes once from a fresh saver", async () => {
  const { config, deps, events, write } = await fixture(driver([ticket(), answer()]), true);
  const paused = await runAgent({ config, ownerId, message: "Create a ticket" }, deps);
  expect(paused.status).toBe("waiting_approval");
  const event = events.find(e => e.type === "approval_required");
  if (event?.type !== "approval_required") throw new Error("missing_approval");
  const approvalId = event.payload.approvalId;
  const row = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
  expect(row.inputHash).toHaveLength(64);
  expect(event.payload.input).toEqual({ subject: "Original", priority: "normal" });
  await expect(resumeAgent({ ownerId: "another-owner", approvalId, approved: true }, deps)).rejects.toThrow("approval_not_found");
  await db.approval.update({ where: { id: approvalId }, data: { input: { subject: "Changed", priority: "normal" } } });
  await expect(resumeAgent({ ownerId, approvalId, approved: true }, deps)).rejects.toThrow("approval_call_mismatch");
  expect(write).not.toHaveBeenCalled();
  await db.approval.update({ where: { id: approvalId }, data: { input: row.input! } });
  const fresh = await saver();
  const result = await resumeAgent({ ownerId, approvalId, approved: true }, { ...deps, checkpointer: async () => fresh });
  expect(result.status).toBe("completed"); expect(write).toHaveBeenCalledOnce();
  await expect(resumeAgent({ ownerId, approvalId, approved: true }, deps)).rejects.toThrow("approval_unavailable");
  expect(await db.demoTicket.count({ where: { ownerId, idempotencyKey: `${paused.runId}:ticket` } })).toBe(1);
});
