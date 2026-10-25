-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "agentVersion" INTEGER,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'playground';

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "mustCall" TEXT[],
    "mustNotCall" TEXT[],
    "mustContain" TEXT[],
    "useGrader" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersion" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "passedCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestCase_agentId_idx" ON "TestCase"("agentId");

-- CreateIndex
CREATE INDEX "TestRun_agentId_agentVersion_createdAt_idx" ON "TestRun"("agentId", "agentVersion", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_source_createdAt_idx" ON "AgentRun"("agentId", "source", "createdAt");

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
