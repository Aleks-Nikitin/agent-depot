-- Older pending approvals remain readable but must not authorize changed payloads.
ALTER TABLE "Approval" ADD COLUMN "inputHash" TEXT;
