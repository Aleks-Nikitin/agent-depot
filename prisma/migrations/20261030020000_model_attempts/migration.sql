CREATE TABLE "ModelAttempt" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "attempt" INTEGER NOT NULL, "modelStep" INTEGER NOT NULL,
  "profile" TEXT NOT NULL, "provider" TEXT NOT NULL, "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved', "reservedCostUsd" DOUBLE PRECISION NOT NULL,
  "inputTokens" DOUBLE PRECISION, "outputTokens" DOUBLE PRECISION, "estimatedCostUsd" DOUBLE PRECISION,
  "reason" TEXT, "durationMs" INTEGER, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3), CONSTRAINT "ModelAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModelAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ModelAttempt_runId_attempt_key" ON "ModelAttempt"("runId", "attempt");
