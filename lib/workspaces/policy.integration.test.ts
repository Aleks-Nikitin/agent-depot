import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { databaseConnectionSummary } from "@/lib/db/connection";
import { createAgent, updateAgent, duplicateAgent, rollbackAgent } from "@/lib/agents/library/store";
import { runAgent } from "@/lib/agents/runtime/run-agent";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import type { ModelDriver } from "@/lib/agents/runtime/model";
import { AgentConfigSchema } from "@/lib/agents/contracts";
import { enqueueRun, enqueueApproval, enqueueEvaluation } from "@/lib/jobs/queue";
import { processExecutionJob } from "@/lib/jobs/worker";
import { cancelJob } from "@/lib/jobs/queries";
import { createTestCase } from "@/lib/evals/test-cases";
import { runEvaluation } from "@/lib/evals/runner";
import { getPublishStatus } from "@/lib/evals/publish-gate";
import { workspaceCall } from "./budget";
import { WorkspacePolicySchema, type WorkspacePolicy } from "./policy";

if (!databaseConnectionSummary().localEndpoint) throw new Error("local_database_required");
const db = getDb(); const owners: string[] = []; const agents: string[] = [];
const input = { name: "Policy fixture", instructions: "Answer safely", model: "gemini", enabledTools: ["create_ticket"] };
const answer = { text: "Done", calls: [], messages: [], inputTokens: 1, outputTokens: 1 };
const driver: ModelDriver = { key: "policy-fixture", estimate: () => 0.00001, turn: async () => answer };
const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver };
async function setup() { const owner = `policy-it-${randomUUID()}`; owners.push(owner); const agent = await createAgent(owner, input); agents.push(agent.id); return { owner, agent, config: AgentConfigSchema.parse(agent.config) }; }
async function policy(ownerId: string, patch: Partial<WorkspacePolicy>) {
  const row = await db.workspace.findUniqueOrThrow({ where: { ownerId } });
  const value = WorkspacePolicySchema.parse({ ...WorkspacePolicySchema.parse(row.policy), ...patch });
  await db.workspace.update({ where: { ownerId }, data: { policy: value } }); return value;
}
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  for (const run of await db.agentRun.findMany({ where: { ownerId: { in: owners } } })) await (await graphCheckpointer()).deleteThread(run.id);
  const jobs = await db.executionJob.findMany({ where: { ownerId: { in: owners } } });
  for (const job of jobs) await db.$queryRaw`SELECT (graphile_worker.remove_job(${job.id})).id::text AS id`;
  await db.executionJob.deleteMany({ where: { ownerId: { in: owners } } });
  await db.testRun.deleteMany({ where: { agentId: { in: agents } } }); await db.agentRun.deleteMany({ where: { ownerId: { in: owners } } });
  await db.localOperation.deleteMany({ where: { ownerId: { in: owners } } }); await db.demoTicket.deleteMany({ where: { ownerId: { in: owners } } });
  await db.agent.deleteMany({ where: { ownerId: { in: owners } } }); await db.workspace.deleteMany({ where: { ownerId: { in: owners } } });
  await db.user.deleteMany({ where: { id: { in: owners } } }); await db.$disconnect();
});

it("arbitrates concurrent provider reservations and retains unknown spend without double billing ownership", async () => {
  const { owner, config } = await setup(); await policy(owner, { dailyBudgetMicros: 10_000, maxConcurrentRuns: 2 });
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  const priced: ModelDriver = { ...driver, estimate: input => input === 1 ? 0.002 : 0.006,
    turn: async () => { calls++; await blocked; return answer; } };
  const runs = [runAgent({ config, ownerId: owner, message: "one" }, { ...deps, driver: priced }), runAgent({ config, ownerId: owner, message: "two" }, { ...deps, driver: priced })];
  try {
    expect(await Promise.race(runs)).toMatchObject({ status: "blocked", stopReason: "workspace_budget_limit" });
    expect(calls).toBe(1); expect((await db.workspaceDay.findFirstOrThrow({ where: { ownerId: owner } })).heldMicros).toBe(6000);
  } finally { release(); }
  await Promise.all(runs);
  expect((await db.workspaceDay.findFirstOrThrow({ where: { ownerId: owner } })).heldMicros).toBe(2000);
  const unavailable = await runAgent({ config, ownerId: owner, message: "unknown" }, { ...deps, driver: { ...priced, turn: async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); } } });
  expect(unavailable.status).toBe("failed");
  expect((await db.workspaceDay.findFirstOrThrow({ where: { ownerId: owner } })).heldMicros).toBe(8000);
  expect(await db.workspaceCharge.count({ where: { ownerId: owner, status: "unknown" } })).toBe(1);
  const callback = vi.fn(async () => ({ cost: 0 }));
  await expect(workspaceCall(owner, randomUUID(), "draft", 0.003, callback, r => r.cost)).rejects.toThrow("workspace_budget_limit");
  expect(callback).not.toHaveBeenCalled(); expect(await db.workspaceSlot.count({ where: { ownerId: owner, active: true } })).toBe(0);
});

it("limits queued and active runs, releases pauses/cancellation, and reacquires slots atomically on approval", async () => {
  const { owner, agent, config } = await setup(); await policy(owner, { maxConcurrentRuns: 1 });
  const results = await Promise.allSettled([enqueueRun(owner, agent.id, "one", randomUUID(), {}, deps), enqueueRun(owner, agent.id, "two", randomUUID(), {}, deps)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  const first = results.find(r => r.status === "fulfilled")!; if (first.status !== "fulfilled") throw new Error("missing receipt");
  await cancelJob(owner, first.value.jobId); await processExecutionJob(first.value.jobId, deps);
  const registry = new Map(runtimeRegistry); registry.set("create_ticket", { ...registry.get("create_ticket")!, approvalExempt: false, canAutoWrite: () => false });
  const writing: ModelDriver = { ...driver, turn: async (_c, messages) => messages.some(m => m.role === "tool") ? answer : { ...answer, text: "", calls: [{ toolId: "create_ticket", toolCallId: "reviewed", input: { subject: "Reviewed" } }] } };
  const reviewed = { ...deps, registry, driver: writing };
  const paused = await runAgent({ config, ownerId: owner, message: "review" }, reviewed); expect(paused.status).toBe("waiting_approval");
  const other = await enqueueRun(owner, agent.id, "occupy slot", randomUUID(), {}, deps);
  const approval = await db.approval.findFirstOrThrow({ where: { runId: paused.runId } });
  await expect(enqueueApproval(owner, approval.id, true)).rejects.toThrow("workspace_concurrency_limit");
  expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("pending");
  await cancelJob(owner, other.jobId); await processExecutionJob(other.jobId, deps);
  const decision = await enqueueApproval(owner, approval.id, true); await processExecutionJob(decision.jobId, reviewed);
  expect((await deps.store.loadRun(paused.runId, owner)).status).toBe("completed");
  expect(await db.workspaceSlot.count({ where: { ownerId: owner, active: true } })).toBe(0);
});

it("narrows saves and execution, invalidates changed workspace evidence, and denies production guest costs", async () => {
  const { owner, agent, config } = await setup();
  const current = await policy(owner, { allowedTools: ["knowledge_search"] });
  await expect(updateAgent(owner, agent.id, input)).rejects.toThrow("workspace_tool_denied");
  await expect(duplicateAgent(owner, agent.id)).rejects.toThrow("workspace_tool_denied");
  await expect(rollbackAgent(owner, agent.id, 1)).rejects.toThrow("workspace_tool_denied");
  await expect(runAgent({ config, ownerId: owner, message: "blocked" }, deps)).rejects.toThrow("workspace_tool_denied");
  await expect(createAgent(owner, { ...input, enabledTools: [], limits: { maxEstimatedCostUsd: 0.05 } })).resolves.toBeDefined();
  const low = { ...current.limits, maxEstimatedCostUsd: 0.01 }; await policy(owner, { limits: low });
  await expect(updateAgent(owner, agent.id, { ...input, enabledTools: [] })).rejects.toThrow("workspace_limit_exceeded");
  await policy(owner, { limits: current.limits });
  const saved = await updateAgent(owner, agent.id, { ...input, enabledTools: ["knowledge_search"] });
  await createTestCase(owner, agent.id, { input: "Answer", mustContain: ["Done"] });
  await runEvaluation(owner, agent.id, undefined, deps); expect((await getPublishStatus(owner, agent.id)).canPublish).toBe(true);
  await policy(owner, { dailyBudgetMicros: 900_000 }); expect((await getPublishStatus(owner, agent.id)).canPublish).toBe(false);
  await runEvaluation(owner, agent.id, undefined, deps); expect((await getPublishStatus(owner, agent.id)).canPublish).toBe(true);
  await policy(owner, { allowedTools: ["knowledge_search", "create_ticket"] });
  const changed = await updateAgent(owner, agent.id, input);
  const mutating: ModelDriver = { ...driver, turn: async () => { await policy(owner, { allowedTools: ["knowledge_search"] });
    return { ...answer, text: "", calls: [{ toolId: "create_ticket", toolCallId: "denied", input: { subject: "Never written" } }] }; } };
  const result = await runAgent({ config: AgentConfigSchema.parse(changed.config), ownerId: owner, message: "recheck" }, { ...deps, driver: mutating });
  expect(result.status).toBe("blocked"); expect(await db.demoTicket.count({ where: { ownerId: owner } })).toBe(0);
  const guest = `policy-guest-${randomUUID()}`; owners.push(guest);
  await db.user.create({ data: { id: guest, name: "Guest", email: `${guest}@example.test`, isAnonymous: true } });
  const guestAgent = await createAgent(guest, { ...input, enabledTools: [] }); agents.push(guestAgent.id);
  await createTestCase(guest, guestAgent.id, { input: "Answer" });
  vi.stubEnv("NODE_ENV", "production");
  await expect(enqueueRun(guest, guestAgent.id, "No paid work", randomUUID(), {}, deps)).rejects.toThrow("guest_execution_disabled");
  await expect(enqueueEvaluation(guest, guestAgent.id, randomUUID(), deps)).rejects.toThrow("guest_execution_disabled");
  await expect(workspaceCall(guest, randomUUID(), "draft", 0.001, async () => answer, () => 0)).rejects.toThrow("guest_execution_disabled");
  expect(await db.workspaceCharge.count({ where: { ownerId: guest } })).toBe(0); void saved;
});
