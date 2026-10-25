-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "testRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "expectedBehavior" TEXT;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'completed',
ADD COLUMN     "testsFingerprint" TEXT;
