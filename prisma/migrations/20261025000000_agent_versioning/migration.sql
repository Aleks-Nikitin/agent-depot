-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publishedVersion" INTEGER;

-- CreateTable
CREATE TABLE "AgentVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentVersion_agentId_idx" ON "AgentVersion"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentVersion_agentId_version_key" ON "AgentVersion"("agentId", "version");

-- AddForeignKey
ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: seed a version row for every existing agent so history is complete.
INSERT INTO "AgentVersion" ("id", "agentId", "version", "name", "config", "createdAt")
SELECT gen_random_uuid(), "id", "version", "name", "config", "createdAt" FROM "Agent"
ON CONFLICT ("agentId", "version") DO NOTHING;
