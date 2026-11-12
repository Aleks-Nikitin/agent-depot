CREATE TABLE "McpAccessKey" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL UNIQUE, "scope" JSONB NOT NULL, "catalogHash" TEXT NOT NULL,
  "audience" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestCount" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "McpAccessKey_ownerId_idx" ON "McpAccessKey"("ownerId");
