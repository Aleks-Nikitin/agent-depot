CREATE TABLE "RuntimeMetric" (
    "runId" TEXT NOT NULL,
    "finishedAt" TIMESTAMPTZ(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersion" INTEGER NOT NULL,
    "modelProfile" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL,
    "stopReason" TEXT,
    "activeMs" INTEGER NOT NULL,
    "modelCalls" INTEGER NOT NULL,
    "toolCalls" INTEGER NOT NULL,
    "inputTokens" DOUBLE PRECISION,
    "outputTokens" DOUBLE PRECISION,
    "estimatedCostUsd" DOUBLE PRECISION,
    CONSTRAINT "RuntimeMetric_pkey" PRIMARY KEY ("runId", "finishedAt"),
    CONSTRAINT "RuntimeMetric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RuntimeMetric_ownerId_finishedAt_idx" ON "RuntimeMetric"("ownerId", "finishedAt");
CREATE INDEX "RuntimeMetric_ownerId_agentId_finishedAt_idx" ON "RuntimeMetric"("ownerId", "agentId", "finishedAt");
