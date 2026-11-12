import type { PrismaClient, Prisma } from "../../generated/prisma/client";

export async function ensureWorkspace(db: PrismaClient | Prisma.TransactionClient, ownerId: string) {
  // Empty-update upsert can race in Prisma; unique ownership is the arbiter.
  await db.workspace.createMany({ data: [{ ownerId }], skipDuplicates: true });
  return db.workspace.findUniqueOrThrow({ where: { ownerId } });
}
