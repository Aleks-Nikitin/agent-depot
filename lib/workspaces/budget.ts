import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { lockedPolicy, type WorkspacePolicy } from "./policy";

export function micros(usd: number) {
  if (!Number.isFinite(usd) || usd < 0 || usd > 1000) throw new Error("invalid_spend_estimate");
  return Math.ceil(usd * 1_000_000);
}

export async function acquireSlot(tx: Prisma.TransactionClient, ownerId: string, key: string, policy: WorkspacePolicy, runId?: string) {
  const prior = await tx.workspaceSlot.findUnique({ where: { key } });
  if (prior?.ownerId !== undefined && prior.ownerId !== ownerId) throw new Error("workspace_slot_mismatch");
  if (prior?.active) return;
  if (await tx.workspaceSlot.count({ where: { ownerId, active: true } }) >= policy.maxConcurrentRuns) throw new HttpError(429, "workspace_concurrency_limit");
  await tx.workspaceSlot.upsert({ where: { key }, create: { key, ownerId, runId }, update: { active: true, acquiredAt: new Date() } });
}

export async function reserveCharge(tx: Prisma.TransactionClient, ownerId: string, key: string, kind: string, usd: number, policy: WorkspacePolicy) {
  const amount = micros(usd);
  // A provider request cannot reuse a prior reservation as authority for a second billable call.
  if (await tx.workspaceCharge.findUnique({ where: { key } })) throw new HttpError(409, "workspace_charge_already_used");
  const [{ day }] = await tx.$queryRaw<{ day: string }[]>`SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day`;
  const bucket = await tx.workspaceDay.upsert({ where: { ownerId_day: { ownerId, day } }, create: { ownerId, day }, update: {} });
  if (amount > policy.dailyBudgetMicros - bucket.heldMicros) throw new HttpError(429, "workspace_budget_limit");
  await tx.workspaceDay.update({ where: { ownerId_day: { ownerId, day } }, data: { heldMicros: { increment: amount } } });
  await tx.workspaceCharge.create({ data: { key, ownerId, day, kind, reservedMicros: amount, chargedMicros: amount } });
}

export async function settleCharge(tx: Prisma.TransactionClient, ownerId: string, key: string, usd: number | null) {
  await lockedPolicy(tx, ownerId);
  const charge = await tx.workspaceCharge.findUniqueOrThrow({ where: { key } });
  if (charge.ownerId !== ownerId || charge.status !== "reserved") throw new Error("workspace_charge_unavailable");
  const amount = usd === null ? charge.reservedMicros : micros(usd);
  await tx.workspaceDay.update({ where: { ownerId_day: { ownerId, day: charge.day } }, data: { heldMicros: { increment: amount - charge.chargedMicros } } });
  await tx.workspaceCharge.update({ where: { key }, data: { chargedMicros: amount, status: usd === null ? "unknown" : "settled" } });
}

/** Auxiliary drafting/grading calls use the same atomic budget and concurrency boundary. */
export async function workspaceCall<T>(ownerId: string, key: string, kind: "draft" | "grader", reservedUsd: number,
  call: () => Promise<T>, cost: (result: T) => number | null): Promise<T> {
  const db = getDb();
  await db.$transaction(async tx => {
    const policy = await lockedPolicy(tx, ownerId, true);
    if (reservedUsd > policy.limits.maxEstimatedCostUsd) throw new HttpError(403, "workspace_limit_exceeded");
    await acquireSlot(tx, ownerId, key, policy); await reserveCharge(tx, ownerId, key, kind, reservedUsd, policy);
  });
  let settled = false;
  try {
    const result = await call();
    await db.$transaction(async tx => { await settleCharge(tx, ownerId, key, cost(result)); }); settled = true;
    return result;
  } finally {
    await db.$transaction(async tx => {
      if (!settled) await settleCharge(tx, ownerId, key, null);
      await tx.workspaceSlot.updateMany({ where: { key, ownerId }, data: { active: false } });
    });
  }
}
