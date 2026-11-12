CREATE TABLE "GitHubConnection" (
  "id" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL UNIQUE,
  "repository" TEXT NOT NULL, "credential" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "allowWrites" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ConnectorOperation" (
  "key" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "repository" TEXT NOT NULL,
  "runId" TEXT NOT NULL, "inputHash" TEXT NOT NULL, "input" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unknown', "result" JSONB, "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "ConnectorOperation_ownerId_createdAt_idx" ON "ConnectorOperation"("ownerId", "createdAt");
