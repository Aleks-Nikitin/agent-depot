import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/prisma";
import { AgentConfigSchema, type AgentConfig } from "@/lib/agents/contracts";
import { AgentInputSchema, type AgentInput } from "./schema";
import { readPublishStatus } from "@/lib/evals/publish-gate";

export type AgentSummary = {
  id: string;
  name: string;
  version: number;
  published: boolean;
  publishedVersion: number | null;
  enabledTools: string[];
  updatedAt: string;
};

export type AgentVersionSummary = {
  version: number;
  name: string;
  createdAt: string;
  isCurrent: boolean;
  isPublished: boolean;
};

export type AgentDetail = {
  id: string;
  name: string;
  version: number;
  published: boolean;
  publishedVersion: number | null;
  config: AgentConfig;
  updatedAt: string;
  versions: AgentVersionSummary[];
};

function buildConfig(
  id: string,
  ownerId: string,
  version: number,
  input: AgentInput,
): AgentConfig {
  return AgentConfigSchema.parse({
    id,
    ownerId,
    version,
    name: input.name,
    instructions: input.instructions,
    model: "gemini",
    enabledTools: input.enabledTools,
    ...(input.limits ? { limits: input.limits } : {}),
  });
}

function summary(row: {
  id: string;
  name: string;
  version: number;
  published: boolean;
  publishedVersion: number | null;
  config: unknown;
  updatedAt: Date;
}): AgentSummary {
  const config = AgentConfigSchema.parse(row.config);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    published: row.published,
    publishedVersion: row.publishedVersion,
    enabledTools: config.enabledTools,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAgents(ownerId: string): Promise<AgentSummary[]> {
  const rows = await getDb().agent.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(summary);
}

export async function getAgent(ownerId: string, id: string): Promise<AgentDetail> {
  const db = getDb();
  const row = await db.agent.findFirst({
    where: { id, ownerId },
    include: { versions: { orderBy: { version: "desc" } } },
  });
  if (!row) throw new Error("agent_not_found");
  const config = AgentConfigSchema.parse(row.config);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    published: row.published,
    publishedVersion: row.publishedVersion,
    config,
    updatedAt: row.updatedAt.toISOString(),
    versions: row.versions.map((v) => ({
      version: v.version,
      name: v.name,
      createdAt: v.createdAt.toISOString(),
      isCurrent: v.version === row.version,
      isPublished: v.version === row.publishedVersion,
    })),
  };
}

export async function createAgent(ownerId: string, raw: unknown): Promise<AgentDetail> {
  const input = AgentInputSchema.parse(raw);
  const id = randomUUID();
  const config = buildConfig(id, ownerId, 1, input);
  const db = getDb();
  await db.$transaction(async (tx) => {
    await tx.agent.create({
      data: { id, ownerId, name: input.name, version: 1, config },
    });
    await tx.agentVersion.create({
      data: { agentId: id, version: 1, name: input.name, config },
    });
    if (input.testCases?.length) await tx.testCase.createMany({ data: input.testCases.map(test => ({ ...test, agentId: id })) });
  });
  return getAgent(ownerId, id);
}

export async function updateAgent(
  ownerId: string,
  id: string,
  raw: unknown,
): Promise<AgentDetail> {
  const input = AgentInputSchema.parse(raw);
  const db = getDb();
  await db.$transaction(async (tx) => {
    const locked = await tx.agent.updateMany({ where: { id, ownerId }, data: { testRevision: { increment: 0 } } });
    if (locked.count !== 1) throw new Error("agent_not_found");
    const current = await tx.agent.findFirst({ where: { id, ownerId } });
    if (!current) throw new Error("agent_not_found");
    const nextVersion = current.version + 1;
    const config = buildConfig(id, ownerId, nextVersion, input);
    await tx.agent.update({
      where: { id },
      data: { name: input.name, version: nextVersion, config },
    });
    await tx.agentVersion.create({
      data: { agentId: id, version: nextVersion, name: input.name, config },
    });
  });
  return getAgent(ownerId, id);
}

export async function duplicateAgent(ownerId: string, id: string): Promise<AgentDetail> {
  const db = getDb();
  const source = await db.agent.findFirst({ where: { id, ownerId } });
  if (!source) throw new Error("agent_not_found");
  const sourceConfig = AgentConfigSchema.parse(source.config);
  const newId = randomUUID();
  const name = `${source.name} (copy)`;
  const config = buildConfig(newId, ownerId, 1, {
    name,
    instructions: sourceConfig.instructions,
    model: "gemini",
    enabledTools: sourceConfig.enabledTools,
    limits: sourceConfig.limits,
  });
  await db.$transaction(async (tx) => {
    await tx.agent.create({ data: { id: newId, ownerId, name, version: 1, config } });
    await tx.agentVersion.create({
      data: { agentId: newId, version: 1, name, config },
    });
  });
  return getAgent(ownerId, newId);
}

export async function rollbackAgent(
  ownerId: string,
  id: string,
  targetVersion: number,
): Promise<AgentDetail> {
  const db = getDb();
  await db.$transaction(async (tx) => {
    const locked = await tx.agent.updateMany({ where: { id, ownerId }, data: { testRevision: { increment: 0 } } });
    if (locked.count !== 1) throw new Error("agent_not_found");
    const current = await tx.agent.findFirst({ where: { id, ownerId } });
    if (!current) throw new Error("agent_not_found");
    const target = await tx.agentVersion.findUnique({
      where: { agentId_version: { agentId: id, version: targetVersion } },
    });
    if (!target) throw new Error("version_not_found");
    const targetConfig = AgentConfigSchema.parse(target.config);
    const nextVersion = current.version + 1;
    // Rollback = forward a new version that restores the old content, so the
    // history stays append-only and auditable.
    const config = buildConfig(id, ownerId, nextVersion, {
      name: target.name,
      instructions: targetConfig.instructions,
      model: "gemini",
      enabledTools: targetConfig.enabledTools,
      limits: targetConfig.limits,
    });
    await tx.agent.update({
      where: { id },
      data: { name: target.name, version: nextVersion, config },
    });
    await tx.agentVersion.create({
      data: { agentId: id, version: nextVersion, name: target.name, config },
    });
  });
  return getAgent(ownerId, id);
}

export async function publishAgent(
  ownerId: string,
  id: string,
  testsPassed?: boolean,
): Promise<AgentDetail> {
  void testsPassed; // Legacy clients may send this; only stored server evidence is trusted.
  const db = getDb();
  await db.$transaction(async tx => {
    const locked = await tx.agent.updateMany({ where: { id, ownerId }, data: { testRevision: { increment: 0 } } });
    if (locked.count !== 1) throw new Error("agent_not_found");
    const status = await readPublishStatus(tx, ownerId, id);
    if (!status.canPublish) throw new Error("tests_not_passed");
    await tx.agent.update({ where: { id }, data: { published: true, publishedVersion: status.agentVersion } });
  });
  return getAgent(ownerId, id);
}

export async function deleteAgent(ownerId: string, id: string): Promise<void> {
  const db = getDb();
  const result = await db.agent.deleteMany({ where: { id, ownerId } });
  if (result.count === 0) throw new Error("agent_not_found");
}
