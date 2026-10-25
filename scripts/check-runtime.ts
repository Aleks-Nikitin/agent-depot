import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../lib/db/prisma";
import { supportAgent, salesAgent } from "../lib/agents/fixtures";
import { runAgent, resumeAgent } from "../lib/agents/runtime/run-agent";
import { runtimeServices } from "../lib/agents/runtime/services";
import { draftAgent, googleDraftGenerator } from "../lib/agents/runtime/draft";
import type { AgentConfig, RunStep } from "../lib/agents/contracts";
import { queryRuntimeMetrics } from "../lib/agents/storage/metrics";

async function main() {
  if (!process.argv.includes("--live")) throw new Error("This command calls the real Gemini API. Run with --live to opt in.");
  const services = runtimeServices();
  const db = getDb();
  const runIds: string[] = [];
  let estimatedCost = 0;
  async function run(config: AgentConfig, message: string, expectedTool: string, decision?: boolean) {
    const events: RunStep[] = [];
    const scoped = { ...config, id: `smoke-${randomUUID()}`, limits: {
      ...config.limits, maxModelCalls: 4, maxToolCalls: 4, maxEstimatedCostUsd: 0.02, maxOutputTokens: 1024, timeoutMs: 90_000,
    } };
    const onEvent = (event: RunStep) => { events.push(event); if (!runIds.includes(event.runId)) runIds.push(event.runId); };
    let result = await runAgent({ config: scoped, ownerId: "demo", message }, { ...services, onEvent });
    assert.ok(events.some(event => event.type === "tool_requested" && event.payload.toolId === expectedTool), "Expected live tool request missing");
    if (decision !== undefined) {
      assert.equal(result.status, "waiting_approval", result.stopReason ?? "expected approval pause");
      assert.equal(await db.runtimeMetric.count({ where: { runId: result.runId } }), 0);
      assert.equal(await db.demoTicket.count({ where: { idempotencyKey: { startsWith: `${result.runId}:` } } }), 0);
      const event = events.find(e => e.type === "approval_required");
      assert.ok(event && event.type === "approval_required");
      result = await resumeAgent({ ownerId: "demo", approvalId: event.payload.approvalId, approved: decision }, { ...services, onEvent });
      assert.equal(await db.demoTicket.count({ where: { idempotencyKey: { startsWith: `${result.runId}:` } } }), decision ? 1 : 0);
    }
    assert.equal(result.status, "completed", result.stopReason ?? "expected completed run");
    assert.ok(result.response);
    const metrics = await db.runtimeMetric.findMany({ where: { runId: result.runId } });
    assert.equal(metrics.length, 1, "Expected one durable terminal metric");
    assert.equal(metrics[0].status, "completed");
    assert.equal(metrics[0].estimatedCostUsd, result.usage.estimatedCostUsd);
    const from = new Date(Math.floor(metrics[0].finishedAt.getTime() / 3_600_000) * 3_600_000);
    const report = await queryRuntimeMetrics(db, { ownerId: "demo", agentId: scoped.id, from, to: new Date(from.getTime() + 3_600_000) });
    assert.equal(report.buckets.length, 1, "Expected the finished run in hourly analytics");
    assert.equal(report.buckets[0].runs, 1);
    estimatedCost += result.usage.estimatedCostUsd ?? 0;
    console.log(`${expectedTool}${decision === undefined ? "" : decision ? " approved" : " rejected"}: passed`);
  }
  try {
    await run(supportAgent, "Use knowledge_search with query 'return'. Can an unused product be returned after 20 days? Answer from the policy.", "knowledge_search");
    await run(salesAgent, "Call sales_lookup now and report which product has the highest revenue in the dataset. Do not answer without using the tool.", "sales_lookup");
    const writer = { ...supportAgent, instructions: "For ticket requests call create_ticket exactly once. If approval is denied, explain the denial without requesting the write again. Never claim success before receiving a tool result." };
    await run(writer, "Create a support ticket with subject 'Runtime smoke approved'.", "create_ticket", true);
    await run(writer, "Create a support ticket with subject 'Runtime smoke rejected'.", "create_ticket", false);
    const generated = await draftAgent("Create a support agent that searches company policy and opens support tickets after human approval.", services.registry, googleDraftGenerator, AbortSignal.timeout(30_000));
    assert.ok(generated.draft.name);
    for (const tool of generated.draft.tools) {
      if (services.registry.get(tool.id)?.kind === "write") assert.equal(tool.requiresApproval, true);
    }
    estimatedCost += generated.usage.estimatedCostUsd ?? 0;
    console.log("Agent drafting: passed");
    console.log(`Live smoke checks and terminal metrics passed. Estimated model cost: $${estimatedCost.toFixed(6)}. No credentials or generated private messages printed.`);
  } finally {
    for (const runId of runIds) {
      await db.demoTicket.deleteMany({ where: { idempotencyKey: { startsWith: `${runId}:` } } });
      await db.agentRun.deleteMany({ where: { id: runId } });
    }
    await db.$disconnect();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Live smoke failed"); process.exitCode = 1; });
