import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "@/lib/db/prisma";
import { createAgent } from "@/lib/agents/library/store";
import { searchKnowledge } from "@/lib/integrations/knowledgeSearch";
import { liveDomainRepository } from "@/lib/agents/domain/prisma-repository";
import { evaluationKnowledge } from "@/lib/evals/manifest";
import { createTestCase } from "@/lib/evals/test-cases";
import { runEvaluation } from "@/lib/evals/runner";
import { getPublishStatus } from "@/lib/evals/publish-gate";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { runtimeRegistry } from "@/lib/integrations/runtime-tools";
import { graphCheckpointer } from "@/lib/agents/runtime/checkpointer";
import { readKnowledgeUpload } from "./upload";
import { saveKnowledge, textDigest } from "./store";
const db = getDb(), owner = `knowledge-${randomUUID()}`, other = `knowledge-other-${randomUUID()}`;
const agentIds: string[] = [];
afterAll(async () => {
  for (const r of await db.agentRun.findMany({ where: { ownerId: owner }, select: { id: true } })) await (await graphCheckpointer()).deleteThread(r.id);
  await db.agentRun.deleteMany({ where: { ownerId: owner } });
  await db.testRun.deleteMany({ where: { agentId: { in: agentIds } } });
  await db.agent.deleteMany({ where: { id: { in: agentIds } } });
  await db.knowledgeDocument.deleteMany({ where: { ownerId: { in: [owner, other] } } });
  await db.workspace.deleteMany({ where: { ownerId: { in: [owner, other] } } }); await db.$disconnect();
});
async function agent() { const a = await createAgent(owner, { name: "Knowledge reader", instructions: "Cite source versions and lines.", enabledTools: ["knowledge_search"] }); agentIds.push(a.id); return a; }
function upload(data: Uint8Array | string, name = "policy.md") {
  const form = new FormData(); form.set("file", new File([typeof data === "string" ? data : Uint8Array.from(data)], name, { type: "text/plain" }));
  return new Request("http://localhost/api/knowledge/upload", { method: "POST", body: form });
}
it("validates actual upload bytes, appends immutable source versions, and rejects stale or cross-owner replacements", async () => {
  const parsed = await readKnowledgeUpload(upload("# Returns\r\nUnused jackets: 30 days."));
  expect(parsed.text).toBe("# Returns\nUnused jackets: 30 days.");
  const { sourceName, id, expectedVersion, ...input } = parsed;
  const doc = await saveKnowledge(owner, input, { sourceName, id, expectedVersion });
  expect(doc.contentHash).toBe(textDigest(parsed.text));
  const changed = await saveKnowledge(owner, { title: "Returns", text: "Unused jackets: 14 days." }, { id: doc.id, expectedVersion: 1, sourceName: "policy.md" });
  expect(changed.version).toBe(2);
  const original = await db.knowledgeRevision.findUniqueOrThrow({ where: { documentId_version: { documentId: doc.id, version: 1 } } });
  expect(original.text).toBe(parsed.text);
  await expect(db.knowledgeRevision.update({ where: { id: original.id }, data: { text: "tampered" } })).rejects.toThrow();
  await expect(saveKnowledge(owner, input, { id: doc.id, expectedVersion: 1 })).rejects.toThrow("knowledge_version_changed");
  await expect(saveKnowledge(other, input, { id: doc.id, expectedVersion: 2 })).rejects.toThrow("knowledge_not_found");
  await expect(readKnowledgeUpload(upload(new Uint8Array([255, 254, 0])))).rejects.toThrow("knowledge_upload_encoding");
  await expect(readKnowledgeUpload(upload("pdf content", "policy.pdf"))).rejects.toThrow("knowledge_upload_type");
  await expect(readKnowledgeUpload(upload("x".repeat(100001)))).rejects.toThrow("knowledge_upload_too_large");
});
it("retrieves only permitted sources with bounded exact citations and no sample fallback for inaccessible private knowledge", async () => {
  const a = await agent(), b = await agent();
  const doc = await saveKnowledge(owner, { title: "Delivery", text: "# Delivery\n\n" + "General terms.\n".repeat(100) + "Tracked parcels arrive in seven business days.", access: "agents", agentIds: [a.id] }, { sourceName: "delivery.md" });
  const allowed = await liveDomainRepository(owner, db, a.id).knowledge();
  expect(allowed.documents.some(d => d.id === doc.id)).toBe(true);
  expect((await liveDomainRepository(owner, db, b.id).knowledge()).documents.some(d => d.id === doc.id)).toBe(false);
  expect((await evaluationKnowledge(db, owner, b.id)).documents.some(d => d.id === doc.id)).toBe(false);
  const result = searchKnowledge({ query: "tracked parcels seven business" }, allowed.documents);
  expect(result.matches[0].id).toBe(doc.id);
  const match = result.matches[0]; expect(match.text).toBe(doc.text.slice(match.citation.startOffset, match.citation.endOffset));
  expect(match.citation).toMatchObject({ version: 1, sourceName: "delivery.md", contentHash: doc.contentHash });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(32768);
  expect(searchKnowledge({ query: "unfindablexylophone" }, allowed.documents).matches).toEqual([]);
  const restricted = await saveKnowledge(other, { title: "Hidden", text: "No fallback", access: "workspace" });
  await db.knowledgeDocument.update({ where: { id: restricted.id }, data: { access: "agents", agentIds: ["another-agent"] } });
  expect(await liveDomainRepository(other, db, "missing").knowledge()).toEqual({ documents: [], sample: false });
});
it("persists provenance in isolated retrieval evidence and invalidates publication after source replacement", async () => {
  const a = await agent();
  const doc = await saveKnowledge(owner, { title: "Verificationzebra", text: "Verificationzebra requires a receipt." });
  await createTestCase(owner, a.id, { input: "Verificationzebra policy?", mustCall: ["knowledge_search"], mustContain: ["receipt"] });
  const deps = { store: new PrismaRunStore(db), registry: runtimeRegistry, driver: { key: "knowledge-offline", estimate: () => 0.00001,
    async turn(_config: unknown, messages: { role: string }[]) {
      if (!messages.some(m => m.role === "tool")) { const input = { query: "Verificationzebra" }; return { text: "", calls: [{ toolId: "knowledge_search", toolCallId: "source", input }], messages: [{ role: "assistant" as const, content: [{ type: "tool-call" as const, toolName: "knowledge_search", toolCallId: "source", input }] }], inputTokens: 1, outputTokens: 1 }; }
      return { text: "A receipt is required, according to the retrieved source.", calls: [], messages: [{ role: "assistant" as const, content: "A receipt is required, according to the retrieved source." }], inputTokens: 1, outputTokens: 1 };
    } } };
  const report = await runEvaluation(owner, a.id, undefined, deps);
  expect(report.results[0].status).toBe("passed"); expect((await getPublishStatus(owner, a.id)).canPublish).toBe(true);
  const event = await db.runEvent.findFirstOrThrow({ where: { runId: report.results[0].runId!, type: "tool_finished" } });
  expect(JSON.stringify(event.payload)).toContain(doc.contentHash);
  await saveKnowledge(owner, { title: doc.title, text: "Verificationzebra does not require a receipt." }, { id: doc.id, expectedVersion: 1 });
  expect((await getPublishStatus(owner, a.id)).canPublish).toBe(false);
});
