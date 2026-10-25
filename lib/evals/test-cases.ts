import { io } from "next/cache";
import { ZodError, z } from "zod";
import { configError } from "@/lib/agents/library/http";
import { getDb } from "@/lib/db/prisma";
import { TestCaseInputSchema, TestSourceSchema } from "./schema";
import type { TestCase } from "./types";
import type { Prisma } from "../../generated/prisma/client";
import { HttpError } from "@/lib/auth/errors";

export async function lockTestAgent(tx: Prisma.TransactionClient, ownerId: string, agentId: string) {
  const result = await tx.agent.updateMany({ where: { id: agentId, ownerId }, data: { testRevision: { increment: 1 } } });
  if (result.count !== 1) throw new Error("agent_not_found");
}

// Server-only CRUD for saved test cases. Do not import from client components.
// TestCase has no owner column, so every read and write checks that the test's agent belongs to the owner.

/** "fixtures" keeps the original fake test cases for UI work without a database. */
export const TESTS_SOURCE = "db" as "db" | "fixtures";

type Row = { id: string; input: string; mustCall: string[]; mustNotCall: string[]; mustContain: string[]; useGrader: boolean; expectedBehavior?: string | null; source: string };

function toTestCase(r: Row): TestCase {
  return { id: r.id, input: r.input, mustCall: r.mustCall, mustNotCall: r.mustNotCall, mustContain: r.mustContain,
    useGrader: r.useGrader, ...(r.expectedBehavior ? { expectedBehavior: r.expectedBehavior } : {}), source: TestSourceSchema.catch("user").parse(r.source) };
}

async function assertAgent(ownerId: string, agentId: string) {
  const agent = await getDb().agent.findFirst({ where: { id: agentId, ownerId }, select: { id: true } });
  if (!agent) throw new Error("agent_not_found");
}

async function ownedTest(ownerId: string, id: string) {
  const row = await getDb().testCase.findFirst({ where: { id, agent: { ownerId } } });
  if (!row) throw new Error("test_not_found");
  return row;
}

export async function listTestCases(ownerId: string, agentId: string): Promise<TestCase[]> {
  await io(); // database reads run per request, not during prerendering
  await assertAgent(ownerId, agentId);
  const rows = await getDb().testCase.findMany({ where: { agentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map(toTestCase);
}

export async function createTestCase(ownerId: string, agentId: string, input: unknown): Promise<TestCase> {
  const data = TestCaseInputSchema.parse(input);
  return getDb().$transaction(async tx => {
    await lockTestAgent(tx, ownerId, agentId);
    if (await tx.testCase.count({ where: { agentId } }) >= 5) throw new HttpError(409, "test_case_limit");
    return toTestCase(await tx.testCase.create({ data: { agentId, ...data } }));
  });
}

/** Partial update: omitted fields keep their saved values; the merged result is validated as a whole. */
export async function updateTestCase(ownerId: string, id: string, input: unknown): Promise<TestCase> {
  const patch = z.record(z.string(), z.unknown()).parse(input);
  const existing = await ownedTest(ownerId, id);
  return getDb().$transaction(async tx => {
    await lockTestAgent(tx, ownerId, existing.agentId);
    const row = await tx.testCase.findUnique({ where: { id } });
    if (!row) throw new Error("test_not_found");
    const data = TestCaseInputSchema.parse({ input: row.input, mustCall: row.mustCall, mustNotCall: row.mustNotCall,
      mustContain: row.mustContain, useGrader: row.useGrader, ...(row.expectedBehavior ? { expectedBehavior: row.expectedBehavior } : {}),
      source: TestSourceSchema.catch("user").parse(row.source), ...patch });
    return toTestCase(await tx.testCase.update({ where: { id }, data }));
  });
}

export async function deleteTestCase(ownerId: string, id: string): Promise<void> {
  const existing = await ownedTest(ownerId, id);
  await getDb().$transaction(async tx => {
    await lockTestAgent(tx, ownerId, existing.agentId);
    await tx.testCase.delete({ where: { id } });
  });
}

/**
 * A suggested test from a Gemini draft: either our check fields, or the draft's own `{ input, expectedBehavior }`
 * shape (no tool checks yet), which is saved with the Gemini grader turned on.
 */
export type DraftTestCase =
  | { input: string; mustCall?: string[]; mustNotCall?: string[]; mustContain?: string[]; useGrader?: boolean }
  | { input: string; expectedBehavior: string };

/** Saves draft-suggested tests with source "gemini". All-or-nothing: one invalid case saves none. */
export async function createTestCasesFromDraft(ownerId: string, agentId: string, testCases: DraftTestCase[]): Promise<TestCase[]> {
  const rows = testCases.map(tc => TestCaseInputSchema.parse("expectedBehavior" in tc
    ? { input: tc.input, expectedBehavior: tc.expectedBehavior, useGrader: true, source: "gemini" }
    : { ...tc, source: "gemini" }));
  return getDb().$transaction(async tx => {
    await lockTestAgent(tx, ownerId, agentId);
    if (rows.length + await tx.testCase.count({ where: { agentId } }) > 5) throw new HttpError(409, "test_case_limit");
    const created = [];
    for (const data of rows) created.push(toTestCase(await tx.testCase.create({ data: { agentId, ...data } })));
    return created;
  });
}

/** HTTP mapping for the test case routes: same shape as Dev 1's agent routes, plus test_not_found. */
export function testCaseError(error: unknown): Response {
  if (error instanceof Error && error.message === "test_not_found") return Response.json({ error: "test_not_found" }, { status: 404 });
  if (error instanceof ZodError) return Response.json({ error: "invalid_input", issues: error.issues }, { status: 400 });
  return configError(error);
}
