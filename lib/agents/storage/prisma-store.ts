import type { PrismaClient, Prisma } from "../../../generated/prisma/client";
import { AgentConfigSchema, RunStepSchema, type AgentConfig, type EventInput, type RunStep } from "../contracts";
import { CheckpointSchema, type Checkpoint, type PendingCall } from "../runtime/state";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
type Tx = Prisma.TransactionClient;
async function insertEvent(tx: Tx, runId: string, ownerId: string, event: EventInput): Promise<RunStep> {
  const run = await tx.agentRun.update({ where: { id: runId, ownerId }, data: { sequence: { increment: 1 } } });
  const saved = await tx.runEvent.create({ data: { runId, sequence: run.sequence, type: event.type, payload: json(event.payload) } });
  return RunStepSchema.parse({ ...saved, schemaVersion: 1, timestamp: saved.timestamp.toISOString() });
}

export class PrismaRunStore {
  constructor(readonly db: PrismaClient) {}

  async createRun(config: AgentConfig, checkpoint: Checkpoint) {
    return this.db.agentRun.create({ data: {
      ownerId: config.ownerId, agentId: config.id, configSnapshot: json(config), checkpoint: json(checkpoint),
    } });
  }
  async loadRun(runId: string, ownerId: string) {
    const run = await this.db.agentRun.findFirst({ where: { id: runId, ownerId } });
    if (!run) throw new Error("run_not_found");
    return { ...run, config: AgentConfigSchema.parse(run.configSnapshot), state: CheckpointSchema.parse(run.checkpoint) };
  }
  async appendEvent(runId: string, ownerId: string, event: EventInput) {
    return this.db.$transaction(tx => insertEvent(tx, runId, ownerId, event));
  }
  async saveCheckpoint(runId: string, ownerId: string, version: number, state: Checkpoint) {
    const result = await this.db.agentRun.updateMany({ where: { id: runId, ownerId, version, status: "running" },
      data: { checkpoint: json(state), version: { increment: 1 } } });
    if (result.count !== 1) throw new Error("stale_checkpoint");
    return version + 1;
  }
  async pauseForApproval(runId: string, ownerId: string, version: number, state: Checkpoint, call: PendingCall) {
    return this.db.$transaction(async tx => {
      const updated = await tx.agentRun.updateMany({ where: { id: runId, ownerId, version, status: "running" },
        data: { checkpoint: json(state), status: "waiting_approval", version: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("stale_checkpoint");
      const approval = await tx.approval.create({ data: { runId, ...call, input: json(call.input), expiresAt: new Date(Date.now() + 15 * 60_000) } });
      const event = await insertEvent(tx, runId, ownerId, { type: "approval_required", payload: {
        ...call, approvalId: approval.id, expiresAt: approval.expiresAt.toISOString(),
      } });
      return { approval, event, version: version + 1 };
    });
  }
  async claimApproval(approvalId: string, ownerId: string, approved: boolean) {
    return this.db.$transaction(async tx => {
      const approval = await tx.approval.findFirst({ where: { id: approvalId, run: { ownerId } } });
      if (!approval) throw new Error("approval_not_found");
      const claim = await tx.approval.updateMany({ where: { id: approvalId, status: "pending", expiresAt: { gt: new Date() } },
        data: { status: approved ? "approved" : "rejected", decidedAt: new Date(), decidedBy: ownerId } });
      if (claim.count !== 1) throw new Error("approval_unavailable");
      const runClaim = await tx.agentRun.updateMany({ where: { id: approval.runId, ownerId, status: "waiting_approval" },
        data: { status: "running", version: { increment: 1 } } });
      if (runClaim.count !== 1) throw new Error("run_unavailable");
      const event = await insertEvent(tx, approval.runId, ownerId, { type: "approval_resolved", payload: {
        approvalId, approved, toolCallId: approval.toolCallId,
      } });
      return { approval, event };
    });
  }
  async finishRun(runId: string, ownerId: string, version: number, state: Checkpoint,
    status: "completed" | "blocked" | "failed", response: string | null, stopReason: string | null) {
    return this.db.$transaction(async tx => {
      const finishedAt = new Date();
      const result = await tx.agentRun.updateMany({ where: { id: runId, ownerId, version, status: "running" },
        data: { status, response, stopReason, checkpoint: json(state), finishedAt, version: { increment: 1 } } });
      if (result.count !== 1) throw new Error("stale_checkpoint");
      const run = await tx.agentRun.findUniqueOrThrow({ where: { id: runId } });
      const config = AgentConfigSchema.parse(run.configSnapshot);
      await tx.runtimeMetric.create({ data: {
        runId, finishedAt, ownerId, agentId: config.id, agentVersion: config.version,
        modelProfile: state.driverKey, status, stopReason, activeMs: Math.ceil(state.activeMs),
        modelCalls: state.modelCalls, toolCalls: state.toolCalls, ...state.usage,
      } });
      return insertEvent(tx, runId, ownerId, status === "completed"
        ? { type: "run_completed", payload: { response: response!, durationMs: state.activeMs, usage: state.usage } }
        : { type: status === "blocked" ? "run_blocked" : "run_failed", payload: { reason: stopReason! } });
    });
  }
  async history(runId: string, ownerId: string, afterSequence = 0) {
    const run = await this.loadRun(runId, ownerId);
    const events = await this.db.runEvent.findMany({ where: { runId, sequence: { gt: afterSequence } }, orderBy: { sequence: "asc" } });
    return { runId, agentId: run.agentId, status: run.status, response: run.response, stopReason: run.stopReason,
      usage: run.state.usage, events: events.map(e => RunStepSchema.parse({ ...e, schemaVersion: 1, timestamp: e.timestamp.toISOString() })) };
  }
}
// Structural interface also permits isolated fake stores in unit tests.
export type RunStore = Pick<PrismaRunStore, "createRun" | "loadRun" | "appendEvent" | "saveCheckpoint" | "pauseForApproval" | "claimApproval" | "finishRun">;
