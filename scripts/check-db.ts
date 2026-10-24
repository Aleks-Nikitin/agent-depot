import "dotenv/config";
import assert from "node:assert/strict";
import { getDb } from "../lib/db/prisma";

async function main() {
  const db = getDb();
  try {
    const run = await db.agentRun.create({
      data: { ownerId: "db-check", agentId: "fixture", configSnapshot: { version: 1 } },
    });
    try {
      await db.$transaction(async (tx) => {
        await tx.agentRun.update({ where: { id: run.id }, data: {
          status: "waiting_approval", sequence: 1, checkpoint: { modelCalls: 1 },
        } });
        await tx.runEvent.create({ data: {
          runId: run.id, sequence: 1, type: "approval_required", payload: { toolId: "demo" },
        } });
        await tx.approval.create({ data: {
          runId: run.id, toolCallId: "call-1", toolId: "demo", input: {},
          expiresAt: new Date(Date.now() + 60_000),
        } });
      });
      const saved = await db.agentRun.findUniqueOrThrow({
        where: { id: run.id }, include: { events: true, approvals: true },
      });
      assert.equal(saved.status, "waiting_approval");
      assert.equal(saved.events.length, 1);
      assert.equal(saved.approvals.length, 1);
      assert.deepEqual(saved.checkpoint, { modelCalls: 1 });
      console.log("Database check passed: run, event, approval, checkpoint persisted.");
    } finally {
      await db.agentRun.delete({ where: { id: run.id } });
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
