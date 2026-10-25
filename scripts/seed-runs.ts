import "dotenv/config";
import type { Prisma } from "../generated/prisma/client";
import { getDb } from "../lib/db/prisma";
import { FIXTURE_NOW, fixtureRuns } from "../lib/fixtures/runs";
import { deriveTrace } from "../lib/playground/reduce-events";

// Inserts the fake runs (#123–#129) as AgentRun + RunEvent (+ Approval) rows so /runs shows database data.
// Attaches them to the existing demo agents (run `npm run db:seed-demo` first). Safe to re-run: it only
// replaces rows whose id starts with "seed-run-". Usage: npx tsx scripts/seed-runs.ts

const AGENT_FOR: Record<string, string> = { "acmestore-support": "support-demo", "competitor-pricing": "sales-demo" };
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

async function main() {
  const db = getDb();
  try {
    const agents = new Map((await db.agent.findMany({ where: { id: { in: Object.values(AGENT_FOR) }, ownerId: "demo" } })).map(a => [a.id, a]));
    const missing = Object.values(AGENT_FOR).filter(id => !agents.has(id));
    if (missing.length) throw new Error(`Missing demo agents: ${missing.join(", ")}. Run npm run db:seed-demo first.`);

    const shift = Date.now() - FIXTURE_NOW; // make fixture timestamps recent
    const at = (iso: string) => new Date(Date.parse(iso) + shift);

    await db.$transaction(async tx => {
      await tx.agentRun.deleteMany({ where: { id: { startsWith: "seed-run-" } } }); // cascades to events and approvals
      for (const fixture of fixtureRuns) {
        const agent = agents.get(AGENT_FOR[fixture.agentId])!;
        const id = `seed-${fixture.id}`;
        // Re-key ids inside payloads (e.g. approval ids) so they match the seeded rows.
        const events = fixture.events.map(e => JSON.parse(JSON.stringify(e).replaceAll(fixture.id, id)) as typeof e);
        const trace = deriveTrace(events);
        const status = fixture.status === "rejected" ? "completed" : fixture.status === "interrupted" ? "failed" : fixture.status;
        const terminal = events.findLast(e => e.type === "run_completed" || e.type === "run_blocked" || e.type === "run_failed");
        const createdAt = at(events[0].timestamp);
        const pending = trace.pendingApproval;
        await tx.agentRun.create({ data: {
          id, ownerId: "demo", agentId: agent.id, agentVersion: agent.version, source: "playground",
          configSnapshot: json(agent.config), status, sequence: events.length, version: 0,
          response: trace.response, stopReason: trace.stopReason,
          createdAt, finishedAt: terminal ? at(terminal.timestamp) : null,
          checkpoint: json({
            schemaVersion: 1, messages: [{ role: "user", content: fixture.input }],
            pending: pending ? [{ toolCallId: pending.toolCallId, toolId: pending.toolId, input: pending.input }] : [],
            seenCallIds: [], modelCalls: trace.totals.modelCalls, toolCalls: trace.totals.toolCalls,
            usage: fixture.usage ?? { inputTokens: null, outputTokens: null, estimatedCostUsd: trace.totals.costUsd },
            startedAt: createdAt.getTime(), activeMs: trace.totals.durationMs ?? 0, approvalMode: "human",
            // Not the live driver key, so a seeded paused run can never be resumed into a real model call.
            driverKey: "gemini-3.1-flash-lite:seed-fixture",
          }),
        } });
        await tx.runEvent.createMany({ data: events.map(e => ({
          eventId: e.eventId, runId: id, sequence: e.sequence, type: e.type, payload: json(e.payload), timestamp: at(e.timestamp),
        })) });
        for (const e of events) {
          if (e.type !== "approval_required") continue;
          const resolved = events.find(r => r.type === "approval_resolved" && r.payload.approvalId === e.payload.approvalId);
          await tx.approval.create({ data: {
            id: e.payload.approvalId, runId: id, toolCallId: e.payload.toolCallId, toolId: e.payload.toolId, input: json(e.payload.input),
            status: resolved?.type === "approval_resolved" ? (resolved.payload.approved ? "approved" : "rejected") : "pending",
            expiresAt: at(e.payload.expiresAt), decidedAt: resolved ? at(resolved.timestamp) : null, decidedBy: resolved ? "demo" : null,
          } });
        }
      }
    });
    console.log(`Seeded ${fixtureRuns.length} runs (seed-run-123 … seed-run-129) on support-demo and sales-demo.`);
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
