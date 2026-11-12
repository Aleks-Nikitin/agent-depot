import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { databaseUrl, databaseConnectionSummary } from "../../db/connection";
import { getDb } from "../../db/prisma";
import { PrismaRunStore } from "../storage/prisma-store";
import { createRegistry } from "../tools/registry";
import { supportAgent } from "../fixtures";
import { createProfileDriver } from "./provider-model";
import { deriveTrace } from "../../playground/reduce-events";
import { runAgent, resumeAgent } from "./run-agent";
import type { ModelDriver, ModelTurn } from "./model";
import type { AgentConfig, RunStep } from "../contracts";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
beforeEach(() => { vi.stubEnv("LANGCHAIN_TRACING_V2", "false"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
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

it("falls back after bounded primary retries without repeating a committed ticket and accounts for every attempt", async () => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-only-key");
  vi.stubEnv("RUNTIME_MODEL_ID", "gemini-3.1-flash-lite");
  vi.stubEnv("RUNTIME_INPUT_USD_PER_MILLION", "0.25"); vi.stubEnv("RUNTIME_OUTPUT_USD_PER_MILLION", "1.5");
  vi.stubEnv("OPENAI_API_KEY", "test-only-key"); vi.stubEnv("OPENAI_RUNTIME_MODEL_ID", "gpt-test");
  vi.stubEnv("OPENAI_RUNTIME_INPUT_USD_PER_MILLION", "1"); vi.stubEnv("OPENAI_RUNTIME_OUTPUT_USD_PER_MILLION", "2");
  vi.stubEnv("RUNTIME_MODEL_MAX_RETRIES", "1"); vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
  let googleCalls = 0;
  let fallbackBody: { messages: { role: string }[] } | undefined;
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      if (++googleCalls > 1) return Response.json({ error: { code: 503, message: "private provider response", status: "UNAVAILABLE" } }, { status: 503 });
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "create_ticket", args: { subject: "Original" } } }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } });
    }
    expect(String(url)).toContain("api.openai.com");
    fallbackBody = JSON.parse(init!.body as string);
    return Response.json({ id: "test-completion", object: "chat.completion", created: 0, model: "gpt-test",
      choices: [{ index: 0, message: { role: "assistant", content: "Ticket created" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  });
  vi.stubGlobal("fetch", fetch);
  const primary = createProfileDriver({ ...supportAgent, fallbackModelProfile: "openai-fallback" });
  const { config, deps, events, write } = await fixture(primary);
  config.fallbackModelProfile = "openai-fallback";
  const result = await runAgent({ config, ownerId, message: "Create a ticket" }, deps);
  expect(result.status).toBe("completed"); expect(write).toHaveBeenCalledOnce();
  expect(googleCalls).toBe(3); expect(fetch).toHaveBeenCalledTimes(4);
  expect(events.filter(e => e.type === "model_recovery").map(e => e.payload.action)).toEqual(["retrying", "using_fallback"]);
  expect(JSON.stringify(events)).not.toContain("private provider response");
  const attempts = await db.modelAttempt.findMany({ where: { runId: result.runId }, orderBy: { attempt: "asc" } });
  expect(attempts.map(a => a.status)).toEqual(["succeeded", "failed", "failed", "succeeded"]);
  expect(attempts.map(a => a.profile)).toEqual(["gemini-primary", "gemini-primary", "gemini-primary", "openai-fallback"]);
  expect(result.usage.estimatedCostUsd).toBeNull();
  const saved = await store.loadRun(result.runId, ownerId);
  expect(saved.state.budgetSpentUsd).toBeCloseTo(attempts.reduce((sum, a) => sum + (a.estimatedCostUsd ?? a.reservedCostUsd), 0));
  expect(await db.demoTicket.count({ where: { ownerId, idempotencyKey: { startsWith: `${result.runId}:` } } })).toBe(1);
  expect(fallbackBody?.messages.some(m => m.role === "tool")).toBe(true);
  const models = deriveTrace(events).items.filter(i => i.kind === "model");
  expect(models[2]).toMatchObject({ recovery: "retrying", status: "failed" });
  expect(models[3]).toMatchObject({ recovery: "using_fallback", model: "gpt-test", status: "done" });
});

it("stops before effects or further paid attempts when usage is unknown or the retained reservation exhausts the budget", async () => {
  const unavailable = Object.assign(new Error("private provider response"), { status: 429 });
  for (const unknown of [false, true]) {
    const first = ticket(); if (unknown) first.inputTokens = null;
    const primary = driver([unknown ? first : unavailable]);
    const fallback = driver([answer()], "fallback"); primary.recovery = { maxRetries: 0, fallback };
    const { config, deps, write } = await fixture(primary);
    const bounded = { ...config, limits: { ...config.limits, maxEstimatedCostUsd: unknown ? 0.05 : 0.006 } };
    const result = await runAgent({ config: bounded, ownerId, message: "Create a ticket" }, deps);
    expect(result.status).toBe("blocked");
    expect(result.stopReason).toBe(unknown ? "usage_unknown" : "budget_limit");
    expect(write).not.toHaveBeenCalled(); expect(fallback.turn).not.toHaveBeenCalled();
    const attempts = await db.modelAttempt.findMany({ where: { runId: result.runId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe(unknown ? "usage_unknown" : "failed");
    expect((await store.loadRun(result.runId, ownerId)).state.budgetSpentUsd).toBeGreaterThan(0);
  }
});
