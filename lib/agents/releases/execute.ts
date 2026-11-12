import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { runAgent, type RuntimeDependencies } from "../runtime/run-agent";
import { PrismaRunStore } from "../storage/prisma-store";
import { artifactHash } from "./fingerprint";
import { resolveServingRelease } from "./resolve";

export function executionKey(ownerId: string, scope: string, key: string) {
  if (!/^[\w.-]{1,128}$/.test(key)) throw new HttpError(400, "idempotency_key_required");
  return artifactHash({ ownerId, scope, key });
}
export async function replayExecution(ownerId: string, key: string, message: string, deps: RuntimeDependencies) {
  const prior = await getDb().agentRun.findUnique({ where: { executionKey: key } });
  if (!prior) return null;
  if (prior.ownerId !== ownerId || prior.input !== message) throw new HttpError(409, "idempotency_key_conflict");
  const history = await new PrismaRunStore(getDb()).history(prior.id, ownerId);
  for (const event of history.events) await deps.onEvent?.(event);
  return { runId: prior.id, status: prior.status, response: prior.response, stopReason: prior.stopReason, usage: history.usage };
}
export async function executeServing(ownerId: string, agentId: string, message: string, requestKey: string, deps: RuntimeDependencies) {
  const key = executionKey(ownerId, `serving:${agentId}`, requestKey);
  const replay = await replayExecution(ownerId, key, message, deps);
  if (replay) return replay;
  const artifact = await resolveServingRelease(ownerId, agentId);
  try {
    return await runAgent({ ...artifact, ownerId, message, binding: { releaseId: artifact.releaseId, executionKey: key, input: message } }, deps);
  } catch (error) {
    // A racing retry can lose only the unique insert, before any model/tool call.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const replay = await replayExecution(ownerId, key, message, deps);
      if (replay) return replay;
    }
    throw error;
  }
}
