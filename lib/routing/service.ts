import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { AgentConfigSchema } from "@/lib/agents/contracts";
import { modelProfileId } from "@/lib/agents/profiles";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { captureProviderSettings } from "@/lib/agents/releases/provider-settings";
import { runtimeServices } from "@/lib/agents/runtime/services";
import type { RuntimeDependencies } from "@/lib/agents/runtime/run-agent";
import { identity } from "@/lib/repairs/service";
import { json } from "@/lib/repairs/regression";
import { lockedPolicy, assertNarrowed } from "@/lib/workspaces/policy";
import { executionKey } from "@/lib/agents/releases/execute";
import { RoutingPolicySchema, selectRoute, routingCatalog } from "./policy";

export const SaveRoutingSchema = z.object({ expectedVersion: z.number().int().positive(), routing: RoutingPolicySchema.nullable() }).strict();
export const BenchmarkRequestSchema = z.object({ repeats: z.number().int().min(1).max(2).default(2), heldOutAcknowledged: z.literal(true), expectedVersion: z.number().int().positive() }).strict();
export const BenchmarkPayloadSchema = z.object({ workloadHash: z.string(), config: AgentConfigSchema, cases: z.array(z.object({ id: z.string(), input: z.string() })), policy: RoutingPolicySchema }).strict();
export async function saveRouting(ownerId: string, agentId: string, raw: unknown) {
  const input = SaveRoutingSchema.parse(raw);
  return getDb().$transaction(async tx => {
    const locked = await tx.agent.updateMany({ where: { id: agentId, ownerId }, data: { testRevision: { increment: 0 } } });
    if (!locked.count) throw new HttpError(404, "agent_not_found");
    const row = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
    if (row.version !== input.expectedVersion) throw new HttpError(409, "agent_version_changed");
    const { routing, ...base } = AgentConfigSchema.parse(row.config); void routing;
    const config = AgentConfigSchema.parse({ ...base, version: row.version + 1, ...(input.routing ? { routing: input.routing } : {}) });
    assertNarrowed(config, await lockedPolicy(tx, ownerId));
    if (config.routing) selectRoute(config, { ...process.env, ...captureProviderSettings(config) });
    await tx.agent.update({ where: { id: agentId }, data: { config, version: config.version } });
    await tx.agentDraft.create({ data: { agentId, version: config.version, name: config.name, config } });
    return { version: config.version };
  });
}
export async function routingView(ownerId: string, agentId: string) {
  const db = getDb(); const row = await db.agent.findFirst({ where: { id: agentId, ownerId } });
  if (!row) throw new HttpError(404, "agent_not_found");
  const config = AgentConfigSchema.parse(row.config);
  let decision = null; let reason: string | null = null;
  try { decision = selectRoute(config, process.env); } catch (e) { reason = e instanceof Error && e.message.startsWith("routing_") ? e.message : "routing_unavailable"; }
  let catalog = {}; try { catalog = routingCatalog(process.env.ROUTING_PROFILE_CATALOG); } catch { reason = "routing_catalog_invalid"; }
  const benchmarks = await db.routingBenchmark.findMany({ where: { ownerId, agentId }, orderBy: { createdAt: "desc" }, take: 10,
    select: { id: true, status: true, createdAt: true } });
  return { agentId, version: config.version, routing: config.routing ?? null, primaryProfile: modelProfileId(config), decision, reason, catalog,
    benchmarks: benchmarks.map(b => ({ ...b, createdAt: b.createdAt.toISOString() })) };
}
export async function scheduleBenchmark(tx: import("@/generated/prisma/client").Prisma.TransactionClient, id: string, phase: string) {
  const key = `benchmark:${id}:${phase}`;
  await tx.$queryRaw`SELECT (graphile_worker.add_job('benchmark_operation', ${JSON.stringify({ benchmarkId: id })}::json, job_key := ${key}, max_attempts := 3)).id::text AS id`;
}
export async function startBenchmark(ownerId: string, agentId: string, key: string, raw: unknown, deps = runtimeServices() as RuntimeDependencies) {
  const input = BenchmarkRequestSchema.parse(raw); const requestKey = executionKey(ownerId, `routing-benchmark:${agentId}`, key);
  return getDb().$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`;
    const prior = await tx.routingBenchmark.findUnique({ where: { requestKey } });
    if (prior) {
      const payload = BenchmarkPayloadSchema.parse(prior.payload);
      if (prior.repeats !== input.repeats || payload.config.version !== input.expectedVersion) throw new HttpError(409, "idempotency_key_conflict");
      return { id: prior.id };
    }
    const current = await identity(tx, ownerId, agentId, deps);
    if (current.config.version !== input.expectedVersion) throw new HttpError(409, "agent_version_changed");
    const policy = current.config.routing; if (!policy) throw new HttpError(409, "save_routing_first");
    selectRoute(current.config, { ...process.env, ...current.providerSettings });
    selectRoute({ ...current.config, routing: { ...policy, mode: "locked", lockedProfile: modelProfileId(current.config) } }, { ...process.env, ...current.providerSettings });
    if (await tx.routingBenchmark.findFirst({ where: { ownerId, agentId, status: { in: ["queued", "running"] } } })) throw new HttpError(409, "benchmark_already_running");
    const id = randomUUID();
    await tx.routingBenchmark.create({ data: { id, ownerId, agentId, requestKey, repeats: input.repeats, baseManifestHash: current.manifest.hash,
      payload: json({ workloadHash: artifactHash({ ...current.manifest.payload, agentVersion: 0, draftHash: "" }), config: current.config, policy, cases: current.cases.map(c => ({ id: c.id, input: c.input })) }) } });
    await scheduleBenchmark(tx, id, "start"); return { id };
  }, { timeout: 15_000 });
}
export async function ownedBenchmark(ownerId: string, id: string) {
  const row = await getDb().routingBenchmark.findFirst({ where: { id, ownerId } });
  if (!row) throw new HttpError(404, "benchmark_not_found"); return row;
}
export async function cancelBenchmark(ownerId: string, id: string) {
  await ownedBenchmark(ownerId, id);
  await getDb().$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "RoutingBenchmark" WHERE "id"=${id} FOR UPDATE`;
    const row = await tx.routingBenchmark.findUniqueOrThrow({ where: { id } });
    if (["completed", "failed", "cancelled"].includes(row.status)) return;
    await tx.routingBenchmark.update({ where: { id }, data: { status: "cancelled", reason: "cancelled", finishedAt: new Date() } });
    if (row.activeJobId) await tx.executionJob.updateMany({ where: { id: row.activeJobId, ownerId }, data: { cancelRequested: true } });
  });
}
