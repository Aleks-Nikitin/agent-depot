import { z } from "zod";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client";

const hour = 3_600_000;
const boundary = z.date().refine(date => date.getTime() % hour === 0, "Use UTC hour boundaries");
export const MetricsWindowSchema = z.object({
  ownerId: z.string().trim().min(1).max(100),
  agentId: z.string().min(1).max(100).optional(),
  from: boundary, to: boundary,
}).strict().refine(window => window.to.getTime() > window.from.getTime()
  && window.to.getTime() - window.from.getTime() <= 31 * 24 * hour, "Window must span 1 hour to 31 days");
const count = z.number().finite().nonnegative();
const BucketSchema = z.object({
  bucket: z.date(), runs: count, completed: count, failed: count, blocked: count,
  activeMsTotal: count, modelCalls: count, toolCalls: count,
  knownInputTokens: count, knownOutputTokens: count, knownEstimatedCostUsd: count,
  unknownUsageRuns: count,
});
export type MetricsBackend = "postgres" | "timescale";

/** Server-only query. Resolve ownerId from authentication, never from a browser body. */
export async function queryRuntimeMetrics(db: Pick<PrismaClient, "$queryRaw">, window: z.input<typeof MetricsWindowSchema>,
  backend: MetricsBackend = z.enum(["postgres", "timescale"]).parse(process.env.RUNTIME_METRICS_BACKEND ?? "postgres")) {
  const { ownerId, agentId, from, to } = MetricsWindowSchema.parse(window);
  const mode = z.enum(["postgres", "timescale"]).parse(backend);
  const agentFilter = agentId ? Prisma.sql`AND "agentId" = ${agentId}` : Prisma.empty;
  const rows = mode === "timescale"
    ? await db.$queryRaw(Prisma.sql`
      SELECT bucket, sum(runs)::double precision AS runs,
        sum(completed)::double precision AS completed, sum(failed)::double precision AS failed,
        sum(blocked)::double precision AS blocked, sum("activeMsTotal")::double precision AS "activeMsTotal",
        sum("modelCalls")::double precision AS "modelCalls", sum("toolCalls")::double precision AS "toolCalls",
        sum("knownInputTokens")::double precision AS "knownInputTokens", sum("knownOutputTokens")::double precision AS "knownOutputTokens",
        sum("knownEstimatedCostUsd")::double precision AS "knownEstimatedCostUsd", sum("unknownUsageRuns")::double precision AS "unknownUsageRuns"
      FROM runtime_metrics_hourly
      WHERE "ownerId" = ${ownerId} ${agentFilter} AND bucket >= ${from} AND bucket < ${to}
      GROUP BY bucket ORDER BY bucket`)
    : await db.$queryRaw(Prisma.sql`
      SELECT date_trunc('hour', "finishedAt", 'UTC') AS bucket,
        count(*)::double precision AS runs,
        count(*) FILTER (WHERE status = 'completed')::double precision AS completed,
        count(*) FILTER (WHERE status = 'failed')::double precision AS failed,
        count(*) FILTER (WHERE status = 'blocked')::double precision AS blocked,
        sum("activeMs")::double precision AS "activeMsTotal",
        sum("modelCalls")::double precision AS "modelCalls", sum("toolCalls")::double precision AS "toolCalls",
        coalesce(sum("inputTokens"), 0)::double precision AS "knownInputTokens",
        coalesce(sum("outputTokens"), 0)::double precision AS "knownOutputTokens",
        coalesce(sum("estimatedCostUsd"), 0)::double precision AS "knownEstimatedCostUsd",
        count(*) FILTER (WHERE "inputTokens" IS NULL OR "outputTokens" IS NULL OR "estimatedCostUsd" IS NULL)::double precision AS "unknownUsageRuns"
      FROM "RuntimeMetric"
      WHERE "ownerId" = ${ownerId} ${agentFilter} AND "finishedAt" >= ${from} AND "finishedAt" < ${to}
      GROUP BY bucket ORDER BY bucket`);
  return { backend: mode, from: from.toISOString(), to: to.toISOString(), buckets: z.array(BucketSchema).parse(rows).map(({ bucket, ...row }) => ({
    bucket: bucket.toISOString(), ...row, averageActiveMs: row.activeMsTotal / row.runs,
  })) };
}
