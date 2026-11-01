-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "servingGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "servingReleaseId" TEXT;

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "executionKey" TEXT,
ADD COLUMN     "input" TEXT,
ADD COLUMN     "releaseId" TEXT,
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "turn" INTEGER;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "configHash" TEXT,
ADD COLUMN     "providerSettings" JSONB;

-- CreateTable
CREATE TABLE "AgentRelease" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "providerSettings" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "releaseId" TEXT,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "providerSettings" JSONB NOT NULL,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "activeRunId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRelease_agentId_createdAt_idx" ON "AgentRelease"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationSession_ownerId_agentId_idx" ON "ConversationSession"("ownerId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_executionKey_key" ON "AgentRun"("executionKey");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_servingReleaseId_fkey" FOREIGN KEY ("servingReleaseId") REFERENCES "AgentRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRelease" ADD CONSTRAINT "AgentRelease_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve historical revisions and fill any legacy agent missing its current snapshot.
INSERT INTO "AgentVersion" ("id", "agentId", "version", "name", "config", "createdAt")
SELECT gen_random_uuid()::text, "id", "version", "name", "config", "updatedAt" FROM "Agent"
ON CONFLICT ("agentId", "version") DO NOTHING;

CREATE FUNCTION reject_artifact_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable_artifact'; END;
$$;
CREATE TRIGGER immutable_draft BEFORE UPDATE ON "AgentVersion"
FOR EACH ROW EXECUTE FUNCTION reject_artifact_update();
CREATE TRIGGER immutable_release BEFORE UPDATE ON "AgentRelease"
FOR EACH ROW EXECUTE FUNCTION reject_artifact_update();
-- Old published flags are deliberately not promoted without complete evaluation evidence.
