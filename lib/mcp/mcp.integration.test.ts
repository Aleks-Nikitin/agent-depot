import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getDb } from "@/lib/db/prisma";
import { createAgent } from "@/lib/agents/library/store";
import { createMcpKey, revokeMcpKey, listMcpKeys } from "./keys";
import { MCP_CATALOG_HASH } from "./catalog";
import { POST, GET } from "@/app/api/mcp/route";
const db = getDb(), owners: string[] = [], agents: string[] = [];
const endpoint = "http://localhost:3000/api/mcp";
beforeEach(() => vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000"));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
 await db.mcpAccessKey.deleteMany({ where: { ownerId: { in: owners } } });
 await db.testRun.deleteMany({ where: { agentId: { in: agents } } }); await db.agent.deleteMany({ where: { id: { in: agents } } });
 await db.workspace.deleteMany({ where: { ownerId: { in: owners } } }); await db.user.deleteMany({ where: { id: { in: owners } } }); await db.$disconnect();
});
async function fixture() {
 const owner = randomUUID(); owners.push(owner);
 await db.user.create({ data: { id: owner, name: "MCP fixture", email: `mcp-${owner}@example.test` } });
 const a = await createAgent(owner, { name: "Selected agent", instructions: "private-instruction-sentinel-never-export", enabledTools: [] }); agents.push(a.id);
 const hidden = await createAgent(owner, { name: "Unselected agent", instructions: "private", enabledTools: [] }); agents.push(hidden.id);
 const key = await createMcpKey(owner, { name: "Read-only test client", expiresDays: 1, agentIds: [a.id], tools: ["list_agents", "get_release_status", "get_test_summary"] });
 return { owner, a, hidden, key };
}
function request(secret: string, method: string, params: unknown = {}, headers: Record<string, string> = {}, signal?: AbortSignal) {
 return new Request(endpoint, { method: "POST", signal, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
it("interoperates with the official MCP client while exporting only selected owned agent/release/test metadata", async () => {
 const { owner, a, hidden, key } = await fixture();
 await db.testRun.create({ data: { agentId: a.id, agentVersion: 1, status: "completed", results: [{ response: "private-answer-sentinel" }], passed: true, passedCount: 1, totalCount: 1, finishedAt: new Date() } });
 const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${key.secret}` } },
  fetch: async (url, init) => { const req = new Request(url, init); return req.method === "GET" ? GET(req) : POST(req); } });
 const client = new Client({ name: "agent-depot-interop-test", version: "1.0.0" });
 try {
  await client.connect(transport);
  const tools = await client.listTools(); expect(tools.tools).toHaveLength(3); expect(tools.tools.every(t => t.annotations?.readOnlyHint)).toBe(true);
  const listed = await client.callTool({ name: "list_agents", arguments: {} });
  expect(listed.structuredContent).toMatchObject({ agents: [{ id: a.id }] }); expect(JSON.stringify(listed)).not.toContain(hidden.id);
  const release = await client.callTool({ name: "get_release_status", arguments: { agentId: a.id } }); expect(release.isError).toBe(false);
  const summary = await client.callTool({ name: "get_test_summary", arguments: { agentId: a.id } });
  expect(summary.structuredContent).toMatchObject({ latestRecordedSuite: { passed: true }, authorizesPublication: false });
  expect((await client.callTool({ name: "get_release_status", arguments: { agentId: hidden.id } })).isError).toBe(true);
  const all = JSON.stringify({ listed, release, summary }); expect(all).not.toContain("private-instruction-sentinel"); expect(all).not.toContain("private-answer-sentinel"); expect(all).not.toContain(key.secret);
  expect(await db.agentRun.count({ where: { ownerId: owner } })).toBe(0); expect(await db.executionJob.count({ where: { ownerId: owner } })).toBe(0);
 } finally { await client.close(); }
});
it("rejects cross-owner scopes, bad origins, secret/catalog/audience drift, expiry, revocation and ungranted tools", async () => {
 const { owner, a, key } = await fixture(), other = await fixture();
 await expect(createMcpKey(owner, { name: "Forged", expiresDays: 1, agentIds: [other.a.id], tools: ["list_agents"] })).rejects.toThrow("agent_not_found");
 const row = await db.mcpAccessKey.findUniqueOrThrow({ where: { id: key.id } }); expect(row.secretHash).toHaveLength(64); expect(JSON.stringify(await listMcpKeys(owner))).not.toContain(key.secret);
 expect((await POST(request("not-a-key", "tools/list"))).status).toBe(401);
 expect((await POST(request(key.secret, "tools/list", {}, { Origin: "https://attacker.example" }))).status).toBe(403);
 const wrongHost = new Request("http://attacker.example/api/mcp", { method: "POST", headers: request(key.secret, "tools/list").headers, body: "{}" }); expect((await POST(wrongHost)).status).toBe(403);
 const limited = await createMcpKey(owner, { name: "List only", expiresDays: 1, agentIds: [a.id], tools: ["list_agents"] });
 expect((await (await POST(request(limited.secret, "tools/call", { name: "get_release_status", arguments: { agentId: a.id } }))).json()).error.code).toBe(-32602);
 await db.mcpAccessKey.update({ where: { id: key.id }, data: { catalogHash: "changed" } }); expect((await POST(request(key.secret, "tools/list"))).status).toBe(401);
 await db.mcpAccessKey.update({ where: { id: key.id }, data: { catalogHash: MCP_CATALOG_HASH, audience: "https://another.example/api/mcp" } }); expect((await POST(request(key.secret, "tools/list"))).status).toBe(401);
 await db.mcpAccessKey.update({ where: { id: key.id }, data: { audience: endpoint, expiresAt: new Date(0) } }); expect((await POST(request(key.secret, "tools/list"))).status).toBe(401);
 await expect(revokeMcpKey(other.owner, limited.id)).rejects.toThrow("mcp_key_not_found"); await revokeMcpKey(owner, limited.id);
 expect((await POST(request(limited.secret, "tools/list"))).status).toBe(401);
});
it("bounds bodies, request rate and protocol/schema handling, honors cancellation and exposes no execution methods", async () => {
 const { a, key } = await fixture();
 expect((await POST(request(key.secret, "initialize", { padding: "x".repeat(20_000) }))).status).toBe(413);
 expect((await POST(request(key.secret, "tools/list", {}, { "MCP-Protocol-Version": "future-unsupported" }))).status).toBe(400);
 expect((await (await POST(request(key.secret, "tools/call", { name: "run_agent", arguments: { agentId: a.id } }))).json()).error.code).toBe(-32602);
 const forged = await (await POST(request(key.secret, "tools/call", { name: "get_release_status", arguments: { agentId: a.id, ownerId: "forged", url: "http://127.0.0.1/private" } }))).json();
 expect(forged.result.isError).toBe(true); expect(JSON.stringify(forged)).not.toContain("127.0.0.1");
 const controller = new AbortController(); controller.abort(); expect((await POST(request(key.secret, "tools/list", {}, {}, controller.signal))).status).toBe(408);
 await db.mcpAccessKey.update({ where: { id: key.id }, data: { windowStartedAt: new Date(), requestCount: 60 } });
 const limited = await POST(request(key.secret, "tools/list")); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60");
});
