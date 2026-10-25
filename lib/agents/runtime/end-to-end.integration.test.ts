import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDb } from "../../db/prisma";
import { supportAgent, salesAgent } from "../fixtures";
import { RunStepSchema, type AgentConfig, type RunStep } from "../contracts";
import { PrismaRunStore } from "../storage/prisma-store";
import { POST as execute } from "../../../app/api/agents/[id]/run/route";
import { POST as decide } from "../../../app/api/approvals/[id]/route";

const db = getDb();
const runIds: string[] = [];
const agentIds: string[] = [];
beforeEach(() => {
  vi.stubEnv("RUNTIME_API_TOKEN", "end-to-end-test-token-not-a-secret");
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key-not-real");
  vi.stubEnv("RUNTIME_MODEL_ID", "gemini-2.5-flash-lite");
  vi.stubEnv("RUNTIME_INPUT_USD_PER_MILLION", "1");
  vi.stubEnv("RUNTIME_OUTPUT_USD_PER_MILLION", "2");
});
afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  for (const runId of runIds.splice(0)) {
    await db.demoTicket.deleteMany({ where: { idempotencyKey: { startsWith: `${runId}:` } } });
    await db.agentRun.deleteMany({ where: { id: runId } });
  }
  await db.agent.deleteMany({ where: { id: { in: agentIds.splice(0) } } });
  await db.$disconnect();
});
async function agent(config: AgentConfig) {
  const copy = { ...config, id: `e2e-${randomUUID()}` }; agentIds.push(copy.id);
  await db.agent.create({ data: { id: copy.id, ownerId: copy.ownerId, name: copy.name, version: copy.version, config: copy } });
  return copy;
}
function request(body: unknown) {
  return new Request("http://localhost/api/test", { method: "POST", headers: {
    authorization: "Bearer end-to-end-test-token-not-a-secret", "content-type": "application/json",
  }, body: JSON.stringify(body) });
}
function providerScript(parts: unknown[][]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) throw new Error("unexpected network request");
    const next = parts.shift(); if (!next) throw new Error("unexpected provider retry");
    return Response.json({ candidates: [{ content: { role: "model", parts: next }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 } });
  }));
}
async function readEvents(response: Response) {
  expect(response.status).toBe(200);
  const events: RunStep[] = [];
  const reader = response.body!.getReader();
  let buffer = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const event = RunStepSchema.parse(JSON.parse(buffer.slice(0, newline)));
        if (!runIds.includes(event.runId)) runIds.push(event.runId);
        events.push(event); buffer = buffer.slice(newline + 1);
      }
    }
  } finally { reader.releaseLock(); }
  expect(buffer).toBe("");
  return events;
}
it("runs two stored configurations through their distinct real demo tools", async () => {
  for (const [config, toolId] of [[supportAgent, "knowledge_search"], [salesAgent, "sales_lookup"]] as const) {
    const saved = await agent(config);
    providerScript([[{ functionCall: { name: toolId, args: { query: "returns" } } }], [{ text: "Answer from retrieved data." }]]);
    const events = await readEvents(await execute(request({ message: "test" }), { params: Promise.resolve({ id: saved.id }) }));
    expect(events.at(-1)?.type).toBe("run_completed");
    const result = events.find(e => e.type === "tool_finished");
    expect(result?.payload).toMatchObject({ toolId, output: { source: toolId === "knowledge_search" ? "demo_policy_dataset" : "demo_sales_dataset" } });
    const history = await new PrismaRunStore(db).history(events[0].runId, "demo");
    expect(history.events).toEqual(events);
  }
});
it("pauses a real demo write and resumes through the approval HTTP handler exactly once", async () => {
  const saved = await agent(supportAgent);
  providerScript([[{ functionCall: { name: "create_ticket", args: { subject: "E2E ticket" } } }], [{ text: "Ticket created." }]]);
  const events = await readEvents(await execute(request({ message: "create ticket" }), { params: Promise.resolve({ id: saved.id }) }));
  const runId = events[0].runId;
  expect(await db.demoTicket.count({ where: { idempotencyKey: { startsWith: `${runId}:` } } })).toBe(0);
  const waiting = events.at(-1)!;
  if (waiting.type !== "approval_required") throw new Error("expected approval wait");
  const context = { params: Promise.resolve({ id: waiting.payload.approvalId }) };
  const resumed = await readEvents(await decide(request({ approved: true }), context));
  expect(resumed.at(-1)?.type).toBe("run_completed");
  expect(resumed[0].sequence).toBe(waiting.sequence + 1);
  expect(new Set([...events, ...resumed].map(e => e.runId))).toEqual(new Set([runId]));
  expect(await db.demoTicket.count({ where: { idempotencyKey: { startsWith: `${runId}:` } } })).toBe(1);
  expect((await decide(request({ approved: true }), context)).status).toBe(409);
});
