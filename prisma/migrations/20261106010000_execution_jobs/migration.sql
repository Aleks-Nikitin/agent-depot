ALTER TABLE "TestRun" ADD COLUMN "jobId" TEXT;
CREATE UNIQUE INDEX "TestRun_jobId_key" ON "TestRun"("jobId");
CREATE TABLE "ExecutionJob" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL UNIQUE, "requestHash" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "payload" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued', "runId" TEXT, "testRunId" TEXT,
 "cancelRequested" BOOLEAN NOT NULL DEFAULT false, "result" JSONB, "reason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "ExecutionJob_ownerId_agentId_status_idx" ON "ExecutionJob"("ownerId", "agentId", "status");
CREATE TABLE "LocalOperation" (
 "key" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "toolId" TEXT NOT NULL,
 "inputHash" TEXT NOT NULL, "result" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LocalOperation_ownerId_idx" ON "LocalOperation"("ownerId");
