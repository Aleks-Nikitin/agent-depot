import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../../../app/api/runtime/metrics/route";
import { getDb } from "../../db/prisma";
import { supportAgent } from "../fixtures";
import { PrismaRunStore } from "./prisma-store";
import { runAgent } from "../runtime/run-agent";

const db = getDb();
const store = new PrismaRunStore(db);
const runIds: string[] = [];
const agentId = `metrics-api-${randomUUID()}`;
const token = "metrics-route-test-token-not-a-secret";
const from = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
const to = new Date(from.getTime() + 3_600_000);
const windowQuery = `from=${from.toISOString()}&to=${to.toISOString()}&agentId=${agentId}`;
function request(query = windowQuery, authenticated = true) {
  return new Request(`http://localhost/api/runtime/metrics?${query}`, {
    headers: authenticated ? { authorization: `Bearer ${token}` } : {},
  });
}
beforeEach(() => {
  vi.stubEnv("RUNTIME_ALLOW_DEMO_TOKEN", "true");
  vi.stubEnv("RUNTIME_API_TOKEN", token);
  vi.stubEnv("RUNTIME_METRICS_BACKEND", "postgres");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  await db.agentRun.deleteMany({ where: { id: { in: runIds } } });
  await db.$disconnect();
});

it("reads actual runtime metrics with owner isolation and no private execution data", async () => {
  for (const ownerId of ["demo", "another-workspace"]) {
    const result = await runAgent({ config: { ...supportAgent, id: agentId, ownerId, enabledTools: [] }, ownerId,
      message: "private input" }, { store, registry: new Map(), driver: {
      key: "metrics-api-test", estimate: (input, output) => (input + 2 * output) / 1_000_000,
      turn: async () => ({ text: "private answer", calls: [], messages: [{ role: "assistant", content: "private answer" }],
        inputTokens: 10, outputTokens: 5, finishReason: "stop" }),
    } });
    runIds.push(result.runId);
    expect(result.status).toBe("completed");
    await db.runtimeMetric.updateMany({ where: { runId: result.runId }, data: { finishedAt: new Date(from.getTime() + 1000) } });
  }
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const report = await response.json();
  expect(report.backend).toBe("postgres");
  expect(report.buckets).toHaveLength(1);
  expect(report.buckets[0]).toMatchObject({ runs: 1, completed: 1, failed: 0, blocked: 0,
    modelCalls: 1, toolCalls: 0, knownInputTokens: 10, knownOutputTokens: 5, unknownUsageRuns: 0 });
  for (const value of ["private input", "private answer", agentId, ...runIds]) expect(JSON.stringify(report)).not.toContain(value);
});

it("rejects unauthorized requests and invalid windows before querying storage", async () => {
  const query = vi.spyOn(db, "$queryRaw");
  expect((await GET(request(windowQuery, false))).status).toBe(401);
  vi.stubEnv("RUNTIME_API_TOKEN", "");
  expect((await GET(request())).status).toBe(503);
  vi.stubEnv("RUNTIME_API_TOKEN", token);
  for (const invalid of ["", `${windowQuery}&ownerId=another-workspace`, `${windowQuery}&from=${from.toISOString()}`,
    `from=invalid&to=${to.toISOString()}`, `from=${to.toISOString()}&to=${from.toISOString()}`,
    `from=${new Date(from.getTime() + 1).toISOString()}&to=${to.toISOString()}`,
    `from=${from.toISOString()}&to=${new Date(from.getTime() + 32 * 24 * 3_600_000).toISOString()}`]) {
    expect((await GET(request(invalid))).status).toBe(400);
  }
  expect(query).not.toHaveBeenCalled();
});

it("returns safe uncached failures without database error details", async () => {
  vi.spyOn(db, "$queryRaw").mockRejectedValue(new Error("private database failure"));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: "runtime_unavailable" });
});
