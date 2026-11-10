CREATE TABLE "RepairCase" (
 "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "sourceRunId" TEXT NOT NULL, "testCaseId" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL, "graphVersion" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'queued',
 "baseVersion" INTEGER NOT NULL, "baseHash" TEXT NOT NULL, "manifestHash" TEXT NOT NULL, "targetManifestHash" TEXT NOT NULL,
 "testsFingerprint" TEXT NOT NULL, "proposalHash" TEXT NOT NULL, "payload" JSONB NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "approved" BOOLEAN, "reviewerId" TEXT, "decidedAt" TIMESTAMP(3), "appliedVersion" INTEGER, "childJobId" TEXT, "reason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "RepairCase_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "RepairCase_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RepairCase_requestKey_key" ON "RepairCase"("requestKey");
CREATE UNIQUE INDEX "RepairCase_childJobId_key" ON "RepairCase"("childJobId");
CREATE INDEX "RepairCase_ownerId_createdAt_idx" ON "RepairCase"("ownerId", "createdAt");
