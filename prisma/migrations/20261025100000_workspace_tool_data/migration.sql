-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordedEmail" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeDocument_ownerId_createdAt_idx" ON "KnowledgeDocument"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecordedEmail_idempotencyKey_key" ON "RecordedEmail"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RecordedEmail_ownerId_createdAt_idx" ON "RecordedEmail"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "RecordedEmail" ADD CONSTRAINT "RecordedEmail_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
