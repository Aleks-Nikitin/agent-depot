CREATE TABLE "EvaluationManifest" (
  "testRunId" TEXT PRIMARY KEY,
  "hash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvaluationManifest_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TRIGGER immutable_evaluation_manifest BEFORE UPDATE ON "EvaluationManifest"
FOR EACH ROW EXECUTE FUNCTION reject_artifact_update();
