import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { AgentConfigSchema } from "../contracts";
import { CheckpointSchema } from "../runtime/state";
import { runAgent, type RuntimeDependencies } from "../runtime/run-agent";
import { resolveDraft, resolveServingRelease } from "../releases/resolve";
import { captureProviderSettings, ProviderSettingsSchema } from "../releases/provider-settings";
import { artifactHash } from "../releases/fingerprint";
import { executionKey, replayExecution } from "../releases/execute";

import { MAX_CONVERSATION_BYTES, MAX_CONVERSATION_TURNS } from "./limits";

export async function createConversation(ownerId: string, agentId: string, target: "draft" | "release", version?: number) {
  const artifact = target === "release" ? await resolveServingRelease(ownerId, agentId) : await (async () => {
    const draft = await resolveDraft(ownerId, agentId, version);
    return { ...draft, releaseId: null, providerSettings: captureProviderSettings(draft.config) };
  })();
  return getDb().conversationSession.create({ data: { ownerId, agentId, draftId: artifact.draftId,
    releaseId: artifact.releaseId, version: artifact.config.version,
    config: artifact.config, providerSettings: artifact.providerSettings, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
}

export async function getConversation(ownerId: string, agentId: string, sessionId: string) {
  const session = await getDb().conversationSession.findFirst({ where: { id: sessionId, ownerId, agentId } });
  if (!session) throw new HttpError(404, "conversation_not_found");
  return session;
}

/** Returns only public run references; private graph/checkpoint state never leaves the server. */
export async function conversationView(ownerId: string, agentId: string, sessionId: string) {
  const session = await getConversation(ownerId, agentId, sessionId);
  const turns = await getDb().agentRun.findMany({ where: { ownerId, agentId, sessionId }, orderBy: { turn: "asc" },
    select: { id: true, input: true, status: true, response: true } });
  return { id: session.id, version: session.version, target: session.releaseId ? "release" as const : "draft" as const,
    expiresAt: session.expiresAt.toISOString(), turnCount: session.turnCount, maxTurns: MAX_CONVERSATION_TURNS,
    activeRunId: session.activeRunId, turns };
}

export async function prepareConversationTurn(ownerId: string, agentId: string, sessionId: string, message: string) {
  const session = await getConversation(ownerId, agentId, sessionId);
  if (session.expiresAt.getTime() <= Date.now()) throw new HttpError(409, "conversation_expired");
  if (session.activeRunId) throw new HttpError(409, "conversation_busy");
  if (session.turnCount >= MAX_CONVERSATION_TURNS) throw new HttpError(409, "conversation_turn_limit");
  const last = await getDb().agentRun.findFirst({ where: { ownerId, agentId, sessionId }, orderBy: { turn: "desc" } });
  if (last && last.status !== "completed") throw new HttpError(409, "conversation_stopped");
  const history = last ? CheckpointSchema.parse(last.checkpoint).messages : [];
  // Compatibility test drivers may omit response.messages. Preserve the recorded answer too.
  if (last?.response && history.at(-1)?.role !== "assistant") {
    history.push({ role: "assistant", content: last.response });
  }
  if (Buffer.byteLength(JSON.stringify([...history, { role: "user", content: message }])) > MAX_CONVERSATION_BYTES) throw new HttpError(409, "conversation_context_limit");
  const config = AgentConfigSchema.parse(session.config);
  if (config.id !== agentId || config.ownerId !== ownerId || config.version !== session.version) throw new HttpError(409, "conversation_artifact_mismatch");
  return { session, config, history, providerSettings: ProviderSettingsSchema.parse(session.providerSettings) };
}

export async function sendConversationTurn(ownerId: string, agentId: string, sessionId: string, message: string, requestKey: string, deps: RuntimeDependencies) {
  await getConversation(ownerId, agentId, sessionId);
  const key = executionKey(ownerId, `conversation:${sessionId}`, requestKey);
  const replay = await replayExecution(ownerId, key, message, deps);
  if (replay) return replay;
  const prepared = await prepareConversationTurn(ownerId, agentId, sessionId, message);
  const { config, history, providerSettings, session } = prepared;
  try {
    return await runAgent({ config, ownerId, message, history, providerSettings,
      binding: { sessionId, releaseId: session.releaseId ?? undefined, input: message, executionKey: key,
        expectedTurn: session.turnCount, artifactHash: artifactHash({ config, providerSettings }) } }, deps);
  } catch (error) {
    // Includes a unique insert race or a session CAS race. Replay only this exact request.
    const replay = await replayExecution(ownerId, key, message, deps);
    if (replay) return replay;
    throw error;
  }
}
