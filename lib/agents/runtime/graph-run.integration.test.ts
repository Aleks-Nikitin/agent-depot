import "dotenv/config";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { databaseUrl, databaseConnectionSummary } from "../../db/connection";
import { getDb } from "../../db/prisma";
import { PrismaRunStore } from "../storage/prisma-store";
import { supportAgent } from "../fixtures";
import { createRegistry } from "../tools/registry";
import { createProfileDriver } from "./provider-model";
import { runAgent, resumeAgent } from "./run-agent";
import type { ModelDriver, ModelTurn } from "./model";
import type { RunStep } from "../contracts";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const db = getDb();
const store = new PrismaRunStore(db);
const runs: string[] = [];
const savers: PostgresSaver[] = [];
async function freshSaver() {
  const saver = PostgresSaver.fromConnString(databaseUrl()!, { schema: "langgraph_checkpoints" });
  savers.push(saver);
  await saver.setup();
  return saver;
}
afterAll(async () => {
  if (savers[0]) for (const id of runs) await savers[0].deleteThread(id);
  await db.agentRun.deleteMany({ where: { id: { in: runs } } });
  await Promise.all(savers.map(s => s.end()));
  await db.$disconnect();
});
const answer = (): ModelTurn => ({ text: "Done", calls: [], messages: [{ role: "assistant", content: "Done" }], inputTokens: 10, outputTokens: 5 });
const request = (toolId: string): ModelTurn => ({ ...answer(), text: "", calls: [{ toolCallId: "call-1", toolId, input: { query: "test" } }],
  messages: [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: toolId, input: { query: "test" } }] }] });
function driver(turns: ModelTurn[]): ModelDriver {
  return { key: "graph-test", estimate: (i, o) => (i + o) / 1_000_000, turn: vi.fn(async () => {
    const turn = turns.shift(); if (!turn) throw new Error("unexpected_model_call"); return turn;
  }) };
}
function dependencies(model: ModelDriver, saver: PostgresSaver, reviewed = false) {
  const run = vi.fn(async () => ({ text: "tool succeeded" }));
  const registry = createRegistry(["knowledge_search", "create_ticket"].map(id => ({ id, description: id,
    kind: id === "create_ticket" ? "write" as const : "read" as const, inputSchema: z.object({ query: z.string() }),
    automaticWrites: !reviewed, approvalExempt: !reviewed, run,
  })));
  const events: RunStep[] = [];
  return { run, events, deps: { store, registry, driver: model, checkpointer: async () => saver, onEvent: (e: RunStep) => {
    events.push(e); if (e.type === "run_started") runs.push(e.runId);
  } } };
}
it("executes permitted tools, persists compatible events and reloads graph checkpoints through a new saver", async () => {
  const saver = await freshSaver();
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-only-key");
  vi.stubEnv("RUNTIME_MODEL_ID", "gemini-3.1-flash-lite");
  vi.stubEnv("RUNTIME_INPUT_USD_PER_MILLION", "0.25");
  vi.stubEnv("RUNTIME_OUTPUT_USD_PER_MILLION", "1.5");
  vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
  let calls = 0;
  const fetch = vi.fn(async () => Response.json({ candidates: [{ content: { role: "model", parts: calls++ === 0
    ? [{ functionCall: { name: "knowledge_search", args: { query: "test" } } }]
    : [{ text: "Done" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2, totalTokenCount: 17 },
  }));
  vi.stubGlobal("fetch", fetch);
  const model = createProfileDriver(supportAgent);
  const { run, events, deps } = dependencies(model, saver);
  const result = await runAgent({ config: supportAgent, ownerId: "demo", message: "test" }, deps);
  expect(result).toMatchObject({ status: "completed", response: "Done" });
  expect(run).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.usage.outputTokens).toBe(14);
  const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("minimal");
  expect(body.tools[0].functionDeclarations.map((t: { name: string }) => t.name)).toEqual(["knowledge_search", "create_ticket"]);
  expect(events.map(e => e.sequence)).toEqual(events.map((_, i) => i + 1));
  expect((await store.history(result.runId, "demo")).events).toEqual(events);
  const checkpoint = await (await freshSaver()).getTuple({ configurable: { thread_id: result.runId } });
  expect(checkpoint?.checkpoint.channel_values.messages).toBeDefined();
  await expect(store.loadRun(result.runId, "another-owner")).rejects.toThrow("run_not_found");
});
it("denies evaluation writes, rejects disabled tools and stops on unknown usage before effects", async () => {
  const saver = await freshSaver();
  for (const scenario of ["deny", "disabled", "unknown"] as const) {
    const turn = request(scenario === "disabled" ? "unpermitted" : "create_ticket");
    if (scenario === "unknown") turn.inputTokens = null;
    const model = driver([turn, answer()]);
    const { run, deps, events } = dependencies(model, saver);
    const result = await runAgent({ config: supportAgent, ownerId: "demo", message: "test", approvalMode: "deny" }, deps);
    expect(run).not.toHaveBeenCalled();
    expect(events.some(e => e.type === "approval_required")).toBe(false);
    if (scenario === "deny") expect(result.status).toBe("completed");
    else expect(result.status).not.toBe("completed");
    if (scenario === "unknown") expect(result.stopReason).toBe("usage_unknown");
  }
});
it("persists a graph interrupt and resumes exact approved arguments once using a fresh saver", async () => {
  vi.stubEnv("LANGCHAIN_TRACING_V2", "true");
  vi.stubEnv("LANGSMITH_API_KEY", "test-only-key");
  const telemetry = vi.fn(async () => new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", telemetry);
  const saver = await freshSaver();
  const { deps, events, run } = dependencies(driver([request("create_ticket"), answer()]), saver, true);
  const paused = await runAgent({ config: supportAgent, ownerId: "demo", message: "test" }, deps);
  expect(paused.status).toBe("waiting_approval");
  expect(run).not.toHaveBeenCalled();
  const event = events.find(e => e.type === "approval_required");
  if (event?.type !== "approval_required") throw new Error("missing_approval");
  const resumedDeps = { ...deps, checkpointer: async () => await freshSaver() };
  const decision = { approvalId: event.payload.approvalId, ownerId: "demo", approved: true };
  const result = await resumeAgent(decision, resumedDeps);
  expect(result.status).toBe("completed");
  const requests = telemetry.mock.calls as unknown as [string, RequestInit][];
  const posts = requests.filter(([, init]) => init?.method === "POST");
  expect(posts).toHaveLength(1);
  for (const [url, init] of requests.filter(([, init]) => init?.method !== "POST")) {
    // The installed SDK may discover server capabilities without sending data.
    expect(new URL(url).pathname).toBe("/info");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
  }
  const trace = JSON.parse(posts[0][1].body as string);
  expect(trace.inputs).toEqual({});
  expect(trace.outputs).toEqual({});
  expect(JSON.stringify(trace)).not.toContain("query");
  expect(JSON.stringify(trace)).not.toContain("tool succeeded");
  expect(run).toHaveBeenCalledExactlyOnceWith({ query: "test" }, expect.objectContaining({ ownerId: "demo", idempotencyKey: `${paused.runId}:call-1` }));
  await expect(resumeAgent(decision, resumedDeps)).rejects.toThrow("approval_unavailable");
  expect(run).toHaveBeenCalledOnce();
});
