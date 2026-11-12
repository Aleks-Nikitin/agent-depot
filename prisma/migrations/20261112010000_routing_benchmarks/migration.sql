ALTER TABLE "TestRun" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'certification';
CREATE TABLE "RoutingBenchmark" (
 "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'queued', "repeats" INTEGER NOT NULL, "baseManifestHash" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "childJobIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "activeJobId" TEXT, "reason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
 CONSTRAINT "RoutingBenchmark_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "RoutingBenchmark_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RoutingBenchmark_requestKey_key" ON "RoutingBenchmark"("requestKey");
CREATE UNIQUE INDEX "RoutingBenchmark_activeJobId_key" ON "RoutingBenchmark"("activeJobId");
CREATE INDEX "RoutingBenchmark_ownerId_agentId_createdAt_idx" ON "RoutingBenchmark"("ownerId", "agentId", "createdAt");
