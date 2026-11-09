ALTER TABLE "Workspace" ADD COLUMN "policy" JSONB NOT NULL DEFAULT '{"allowedTools":["knowledge_search","sales_lookup","order_lookup","create_ticket","send_email","google_shopping","google_news","read_webpage"],"dailyBudgetMicros":1000000,"maxConcurrentRuns":4,"limits":{"maxModelCalls":10,"maxWriteCalls":5,"maxToolCalls":20,"maxEstimatedCostUsd":1,"maxOutputTokens":2048,"timeoutMs":120000}}';
CREATE TABLE "WorkspaceSlot" (
 "key" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "Workspace"("ownerId") ON DELETE CASCADE,
 "runId" TEXT UNIQUE REFERENCES "AgentRun"("id") ON DELETE CASCADE, "active" BOOLEAN NOT NULL DEFAULT true,
 "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "WorkspaceSlot_ownerId_active_idx" ON "WorkspaceSlot"("ownerId","active");
CREATE TABLE "WorkspaceDay" (
 "ownerId" TEXT NOT NULL REFERENCES "Workspace"("ownerId") ON DELETE CASCADE, "day" TEXT NOT NULL,
 "heldMicros" INTEGER NOT NULL DEFAULT 0 CHECK ("heldMicros">=0), PRIMARY KEY ("ownerId","day"));
CREATE TABLE "WorkspaceCharge" (
 "key" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "day" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "reservedMicros" INTEGER NOT NULL CHECK ("reservedMicros">=0), "chargedMicros" INTEGER NOT NULL CHECK ("chargedMicros">=0),
 "status" TEXT NOT NULL DEFAULT 'reserved', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("ownerId","day") REFERENCES "WorkspaceDay"("ownerId","day") ON DELETE CASCADE);
CREATE INDEX "WorkspaceCharge_ownerId_day_idx" ON "WorkspaceCharge"("ownerId","day");
INSERT INTO "WorkspaceSlot" ("key","ownerId","runId") SELECT 'run:' || r."id",r."ownerId",r."id" FROM "AgentRun" r
 JOIN "Workspace" w ON w."ownerId"=r."ownerId" WHERE r."status"='running';
