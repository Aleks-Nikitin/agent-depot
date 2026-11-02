CREATE TABLE "WorkspaceOrder" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceOrder_totalCents_check" CHECK ("totalCents" >= 0)
);
CREATE UNIQUE INDEX "WorkspaceOrder_ownerId_orderId_key" ON "WorkspaceOrder"("ownerId", "orderId");
