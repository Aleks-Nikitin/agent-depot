ALTER TABLE "KnowledgeDocument" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sourceName" TEXT, ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "access" TEXT NOT NULL DEFAULT 'workspace', ADD COLUMN "agentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE TABLE "KnowledgeRevision" (
  "id" TEXT NOT NULL PRIMARY KEY, "documentId" TEXT NOT NULL,
  "version" INTEGER NOT NULL, "title" TEXT NOT NULL, "text" TEXT NOT NULL,
  "sourceName" TEXT, "contentHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "KnowledgeRevision_documentId_version_key" ON "KnowledgeRevision"("documentId", "version");
UPDATE "KnowledgeDocument" SET "contentHash"=encode(sha256(convert_to("text", 'UTF8')), 'hex');
INSERT INTO "KnowledgeRevision" ("id", "documentId", "version", "title", "text", "contentHash", "createdAt")
  SELECT "id" || ':1', "id", 1, "title", "text", "contentHash", "createdAt" FROM "KnowledgeDocument";
CREATE FUNCTION prevent_knowledge_revision_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'knowledge_revision_immutable'; END $$;
CREATE TRIGGER "KnowledgeRevision_immutable" BEFORE UPDATE ON "KnowledgeRevision" FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_revision_update();
