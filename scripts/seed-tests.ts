import "dotenv/config";
import type { Prisma } from "../generated/prisma/client";
import { AgentConfigSchema } from "../lib/agents/contracts";
import { getDb } from "../lib/db/prisma";
import { TestCaseInputSchema } from "../lib/evals/schema";
import type { TestResult } from "../lib/evals/types";
import { fixtureTestCases, fixtureTestReport } from "../lib/fixtures/tests";

// Demo data for the Evaluation Lab on support-demo (run `npm run db:seed-demo` first). Safe to re-run.
// - Test cases: the 5 demo cases (replaces only cases whose question matches a demo case).
// - Versions: v1 published, current version at least v2 (adds missing AgentVersion rows; never downgrades).
// - TestRuns: a passing 5/5 run on the published v1 and a failing 4/5 run (price-match) on the current version.
// Usage: npx tsx scripts/seed-tests.ts

const AGENT_ID = "support-demo";
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

async function main() {
  const db = getDb();
  try {
    const agent = await db.agent.findFirst({ where: { id: AGENT_ID, ownerId: "demo" } });
    if (!agent) throw new Error(`Missing agent ${AGENT_ID}. Run npm run db:seed-demo first.`);
    const config = AgentConfigSchema.parse(agent.config);
    const current = Math.max(agent.version, 2);
    const rows = fixtureTestCases.map(({ input, mustCall, mustNotCall, mustContain, useGrader, source }) =>
      TestCaseInputSchema.parse({ input, mustCall, mustNotCall, mustContain, useGrader, source }));

    const summary = await db.$transaction(async tx => {
      // Versions: same config as now, with config.version matching each version (the runtime checks this).
      for (const version of [1, current]) {
        await tx.agentVersion.upsert({ where: { agentId_version: { agentId: AGENT_ID, version } }, update: {},
          create: { agentId: AGENT_ID, version, name: agent.name, config: json({ ...config, version }) } });
      }
      if (agent.version < current) {
        await tx.agent.update({ where: { id: AGENT_ID }, data: { version: current, config: json({ ...config, version: current }) } });
      }
      await tx.agent.update({ where: { id: AGENT_ID }, data: { published: true, publishedVersion: 1 } });

      // Test cases.
      await tx.testCase.deleteMany({ where: { agentId: AGENT_ID, input: { in: rows.map(r => r.input) } } });
      const cases: Array<{ id: string }> = [];
      for (const data of rows) cases.push(await tx.testCase.create({ data: { agentId: AGENT_ID, ...data }, select: { id: true } }));

      // Test runs: results keyed by the newly created case ids.
      const idFor = new Map(fixtureTestCases.map((f, i) => [f.id, cases[i].id]));
      const failing: TestResult[] = fixtureTestReport.results.map(r => ({ ...r, testCaseId: idFor.get(r.testCaseId)!, runId: null }));
      const passing: TestResult[] = failing.map(r => ({ ...r, status: "passed", failures: [], response: null }));
      const count = (results: TestResult[]) => results.filter(r => r.status === "passed").length;
      await tx.testRun.deleteMany({ where: { id: { startsWith: "seed-testrun-" } } });
      await tx.testRun.create({ data: { id: "seed-testrun-v1-pass", agentId: AGENT_ID, agentVersion: 1, results: json(passing),
        passed: true, passedCount: count(passing), totalCount: passing.length, createdAt: new Date(Date.now() - 60 * 60_000) } });
      await tx.testRun.create({ data: { id: `seed-testrun-v${current}-fail`, agentId: AGENT_ID, agentVersion: current, results: json(failing),
        passed: false, passedCount: count(failing), totalCount: failing.length, createdAt: new Date(Date.now() - 40_000) } });
      return `${cases.length} test cases; v1 published (5/5 passing run); v${current} current (${count(failing)}/${failing.length} failing run)`;
    });
    console.log(`Seeded ${AGENT_ID}: ${summary}.`);
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
