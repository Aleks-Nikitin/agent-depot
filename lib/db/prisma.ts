import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { databaseUrl } from "./connection";

const globalDb = globalThis as unknown as { agentDepotDb?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalDb.agentDepotDb) return globalDb.agentDepotDb;
  const connectionString = databaseUrl();
  if (!connectionString) throw new Error("Selected database URL is required");
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 10_000 }) });
  globalDb.agentDepotDb = client;
  return client;
}
