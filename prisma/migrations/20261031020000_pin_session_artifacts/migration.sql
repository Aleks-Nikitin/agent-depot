CREATE FUNCTION protect_conversation_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId" OR NEW."agentId" IS DISTINCT FROM OLD."agentId"
    OR NEW."draftId" IS DISTINCT FROM OLD."draftId" OR NEW."releaseId" IS DISTINCT FROM OLD."releaseId"
    OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."config" IS DISTINCT FROM OLD."config"
    OR NEW."providerSettings" IS DISTINCT FROM OLD."providerSettings" THEN
    RAISE EXCEPTION 'immutable_conversation_artifact';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pinned_conversation BEFORE UPDATE ON "ConversationSession"
FOR EACH ROW EXECUTE FUNCTION protect_conversation_artifact();
ALTER TABLE "ConversationSession" ADD CONSTRAINT "conversation_turn_bound" CHECK ("turnCount" BETWEEN 0 AND 10);
