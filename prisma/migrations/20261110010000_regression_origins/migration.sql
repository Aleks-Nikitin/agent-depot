CREATE TABLE "RegressionOrigin" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "runId" TEXT NOT NULL,
  "testCaseId" TEXT NOT NULL, "sourceHash" TEXT NOT NULL, "definitionHash" TEXT NOT NULL,
  "evidence" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegressionOrigin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RegressionOrigin_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RegressionOrigin_runId_key" ON "RegressionOrigin"("runId");
CREATE UNIQUE INDEX "RegressionOrigin_testCaseId_key" ON "RegressionOrigin"("testCaseId");
CREATE INDEX "RegressionOrigin_ownerId_idx" ON "RegressionOrigin"("ownerId");
