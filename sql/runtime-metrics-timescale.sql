-- Optional, run only after Prisma migrations on a TimescaleDB-capable database.
-- Run during setup/maintenance: converting existing data takes table locks.
CREATE EXTENSION IF NOT EXISTS timescaledb;
LOCK TABLE "AgentRun" IN SHARE ROW EXCLUSIVE MODE;
SELECT create_hypertable('"RuntimeMetric"', by_range('finishedAt', INTERVAL '1 day'),
  if_not_exists => TRUE, migrate_data => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS runtime_metrics_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 hour', "finishedAt") AS bucket, "ownerId", "agentId",
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
FROM "RuntimeMetric" GROUP BY bucket, "ownerId", "agentId" WITH NO DATA;

SELECT add_continuous_aggregate_policy('runtime_metrics_hourly',
  start_offset => NULL, end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);
