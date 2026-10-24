import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const globalDb = globalThis as unknown as { agentDepotDb?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalDb.agentDepotDb) return globalDb.agentDepotDb;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  globalDb.agentDepotDb = client;
  return client;
}
