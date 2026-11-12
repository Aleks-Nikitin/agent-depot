import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { AgentConfig } from "@/lib/agents/contracts";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { lockedPolicy } from "@/lib/workspaces/policy";
import { HttpError } from "@/lib/auth/errors";
import { GITHUB_TOOLS, GitHubConnectionInputSchema, IssueDraftSchema, IssueListSchema } from "./contracts";
import { encryptCredential, decryptCredential, connectorEncryptionReady } from "./secrets";
import { ConnectorError, GitHubIssueSchema, githubRequest, issueResult } from "./github-http";

const metadata = { id: true, repository: true, revision: true, allowWrites: true, enabled: true } as const;
export function connectionSummary(ownerId: string) { return getDb().gitHubConnection.findUnique({ where: { ownerId }, select: metadata }); }
export async function connectGitHub(ownerId: string, raw: unknown, signal: AbortSignal, fetcher?: typeof fetch) {
  const input = GitHubConnectionInputSchema.parse(raw);
  if (!connectorEncryptionReady()) throw new HttpError(503, "connector_encryption_unavailable");
  if ((await getDb().user.findUnique({ where: { id: ownerId }, select: { isAnonymous: true } }))?.isAnonymous) throw new HttpError(403, "connector_registered_account_required");
  const remote = z.object({ full_name: z.string(), has_issues: z.boolean() }).parse(await githubRequest(input.repository, input.token, "", { signal, fetcher }));
  if (remote.full_name.toLowerCase() !== input.repository.toLowerCase() || !remote.has_issues) throw new HttpError(400, "connector_repository_unavailable");
  return getDb().$transaction(async tx => {
    const policy = await lockedPolicy(tx, ownerId);
    const current = await tx.gitHubConnection.findUnique({ where: { ownerId } });
    const id = current?.id ?? randomUUID(), revision = (current?.revision ?? 0) + 1;
    const data = { repository: input.repository, credential: encryptCredential(input.token, ownerId, id, revision), revision, allowWrites: input.allowWrites, enabled: true };
    const row = await tx.gitHubConnection.upsert({ where: { ownerId }, create: { id, ownerId, ...data }, update: data, select: metadata });
    // The connection form explicitly grants these workspace capabilities. Existing
    // agents still need their own immutable connection binding and enabled tools.
    const allowedTools = [...new Set([...policy.allowedTools.filter(t => !GITHUB_TOOLS.includes(t as typeof GITHUB_TOOLS[number])), "github_list_issues", ...(input.allowWrites ? ["github_create_issue"] : [])])];
    await tx.workspace.update({ where: { ownerId }, data: { policy: { ...policy, allowedTools } } });
    return row;
  });
}
export async function disconnectGitHub(ownerId: string) {
  await getDb().$transaction(async tx => {
    await lockedPolicy(tx, ownerId);
    await tx.gitHubConnection.updateMany({ where: { ownerId }, data: { enabled: false, credential: "", revision: { increment: 1 } } });
  });
}
async function boundConnection(tx: Prisma.TransactionClient, config: AgentConfig, write: boolean) {
  const binding = config.github;
  if (!binding || !connectorEncryptionReady()) throw new ConnectorError("connector_not_connected");
  const connection = await tx.gitHubConnection.findFirst({ where: { id: binding.connectionId, ownerId: config.ownerId, enabled: true, revision: binding.revision } });
  if (!connection || (write && !connection.allowWrites) || (binding.repository && binding.repository !== connection.repository)) throw new ConnectorError("connector_scope_changed");
  return connection;
}
export async function githubAvailable(config: AgentConfig, write: boolean) {
  try { await boundConnection(getDb(), config, write); return true; } catch { return false; }
}
export async function listGitHubIssues(config: AgentConfig, raw: unknown, signal: AbortSignal, fetcher?: typeof fetch) {
  const input = IssueListSchema.parse(raw);
  const c = await boundConnection(getDb(), config, false);
  const token = decryptCredential(c.credential, config.ownerId, c.id, c.revision);
  const rawIssues = z.array(GitHubIssueSchema).max(30).parse(await githubRequest(c.repository, token, `/issues?state=${input.state}&per_page=10`, { signal, fetcher }));
  return { repository: c.repository, issues: rawIssues.filter(i => !i.pull_request).map(i => ({ ...issueResult(c.repository, i), excerpt: (i.body ?? "").slice(0, 1500) })), truncated: rawIssues.length === 10 };
}
export async function createGitHubIssue(config: AgentConfig, raw: unknown, context: { idempotencyKey: string; runId: string; signal: AbortSignal }, fetcher?: typeof fetch) {
  const input = IssueDraftSchema.parse(raw), inputHash = artifactHash(input);
  const db = getDb();
  // Receipt is committed separately BEFORE opening the external-effect transaction.
  const intent = await db.$transaction(async tx => {
    const policy = await lockedPolicy(tx, config.ownerId);
    if (!policy.allowedTools.includes("github_create_issue")) throw new ConnectorError("workspace_tool_denied");
    const c = await boundConnection(tx, config, true);
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${context.idempotencyKey}, 0))`;
    const prior = await tx.connectorOperation.findUnique({ where: { key: context.idempotencyKey } });
    if (prior && (prior.ownerId !== config.ownerId || prior.connectionId !== c.id || prior.revision !== c.revision || prior.inputHash !== inputHash)) throw new ConnectorError("idempotency_conflict");
    if (prior) return { operation: prior, fresh: false };
    const operation = await tx.connectorOperation.create({ data: { key: context.idempotencyKey, ownerId: config.ownerId, connectionId: c.id, revision: c.revision, repository: c.repository, runId: context.runId, inputHash, input } });
    return { operation, fresh: true };
  });
  if (!intent.fresh) {
    if (intent.operation.status === "completed") return intent.operation.result;
    throw new ConnectorError(intent.operation.reason ?? "connector_outcome_unknown");
  }
  try {
    return await db.$transaction(async tx => {
      const policy = await lockedPolicy(tx, config.ownerId);
      if (!policy.allowedTools.includes("github_create_issue")) throw new ConnectorError("workspace_tool_denied");
      // Disconnect and rotation wait for in-flight writes to settle. No new POST
      // can start after those actions return. Rollback leaves the durable unknown receipt.
      await tx.$queryRaw`SELECT "id" FROM "GitHubConnection" WHERE "id"=${intent.operation.connectionId} FOR UPDATE`;
      const c = await boundConnection(tx, config, true);
      context.signal.throwIfAborted();
      const token = decryptCredential(c.credential, config.ownerId, c.id, c.revision);
      const marker = artifactHash({ key: context.idempotencyKey, inputHash, connectionId: c.id, revision: c.revision });
      const result = issueResult(c.repository, await githubRequest(c.repository, token, "/issues", { signal: context.signal, fetcher,
        body: { title: input.title, body: `${input.body}\n\n<!-- agent-depot-operation:${marker} -->` } }));
      await tx.connectorOperation.update({ where: { key: context.idempotencyKey }, data: { status: "completed", result, finishedAt: new Date() } });
      return result;
    }, { timeout: 15_000 });
  } catch (error) {
    const known = error instanceof ConnectorError && error.definitive;
    const reason = error instanceof ConnectorError ? error.reason : "connector_outcome_unknown";
    await db.connectorOperation.updateMany({ where: { key: context.idempotencyKey, status: "unknown" }, data: { status: known ? "rejected" : "unknown", reason } });
    throw new ConnectorError(reason);
  }
}
export async function reconcileGitHubIssue(ownerId: string, key: string, signal: AbortSignal, fetcher?: typeof fetch) {
  const op = await getDb().connectorOperation.findFirst({ where: { key, ownerId } });
  if (!op) throw new HttpError(404, "connector_operation_not_found");
  if (op.status !== "unknown") return { status: op.status, result: op.result };
  const config = { ownerId, github: { connectionId: op.connectionId, revision: op.revision } } as AgentConfig;
  const c = await boundConnection(getDb(), config, true);
  const token = decryptCredential(c.credential, ownerId, c.id, c.revision);
  const input = IssueDraftSchema.parse(op.input);
  const marker = artifactHash({ key, inputHash: op.inputHash, connectionId: c.id, revision: c.revision });
  const since = new Date(op.createdAt.getTime() - 60_000).toISOString();
  const found = [];
  for (let page = 1; page <= 3; page++) {
    const issues = z.array(GitHubIssueSchema).max(100).parse(await githubRequest(c.repository, token, `/issues?state=all&since=${encodeURIComponent(since)}&per_page=100&page=${page}`, { signal, fetcher }));
    found.push(...issues.filter(i => !i.pull_request && i.title === input.title && i.body === `${input.body}\n\n<!-- agent-depot-operation:${marker} -->`));
    if (issues.length < 100) break;
  }
  if (found.length !== 1) return { status: "unknown", result: null };
  const result = issueResult(c.repository, found[0]);
  await getDb().connectorOperation.updateMany({ where: { key, ownerId, status: "unknown" }, data: { status: "completed", result, finishedAt: new Date(), reason: null } });
  return { status: "completed", result };
}
