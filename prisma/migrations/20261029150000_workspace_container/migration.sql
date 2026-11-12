CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'My workspace',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Workspace_ownerId_key" ON "Workspace"("ownerId");

-- Include legacy/script owners that do not have an authentication record.
INSERT INTO "Workspace" ("id", "ownerId")
SELECT 'workspace:' || owner_id, owner_id FROM (
  SELECT "id" AS owner_id FROM "user"
  UNION SELECT "ownerId" FROM "Agent"
  UNION SELECT "ownerId" FROM "AgentRun"
  UNION SELECT "ownerId" FROM "KnowledgeDocument"
  UNION SELECT "ownerId" FROM "DemoTicket"
  UNION SELECT "ownerId" FROM "RecordedEmail"
  UNION SELECT "ownerId" FROM "RuntimeMetric"
) owners
ON CONFLICT ("ownerId") DO NOTHING;
