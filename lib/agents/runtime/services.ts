import { getDb } from "../../db/prisma";
import { runtimeRegistry } from "../../integrations/runtime-tools";
import { AgentConfigSchema } from "../contracts";
import { PrismaRunStore } from "../storage/prisma-store";
import { createGoogleDriver } from "./model";

export async function loadAgent(id: string, ownerId: string) {
  const row = await getDb().agent.findFirst({ where: { id, ownerId } });
  if (!row) throw new Error("agent_not_found");
  const config = AgentConfigSchema.parse(row.config);
  if (config.id !== row.id || config.ownerId !== ownerId || config.version !== row.version) throw new Error("invalid_agent_record");
  return config;
}
export function runtimeServices() {
  return { store: new PrismaRunStore(getDb()), registry: runtimeRegistry, driver: createGoogleDriver() };
}
