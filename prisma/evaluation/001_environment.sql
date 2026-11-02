-- Apply only to the dedicated agentdepot_eval database using eval:setup.
CREATE SCHEMA IF NOT EXISTS agentdepot_eval;
CREATE TABLE IF NOT EXISTS agentdepot_eval."Attempt" (
  "id" TEXT PRIMARY KEY,
  "schemaName" TEXT UNIQUE NOT NULL,
  "ownerId" TEXT NOT NULL,
  "suiteId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "knowledgeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 hour',
  CHECK ("schemaName" ~ '^attempt_[a-f0-9]{32}$')
);
