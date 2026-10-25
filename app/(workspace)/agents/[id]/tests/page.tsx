import { AuthPrompt } from "@/components/auth/auth-prompt";
import { pageOwnerOrNull } from "@/lib/auth/session";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAgentHeader } from "@/components/shell/agent-header";
import { TestsScreen } from "@/components/tests/summary-card";
import { TOOL_IDS } from "@/lib/evals/schema";
import { getPublishStatus, latestTestReport, getTestQuality } from "@/lib/evals/publish-gate";
import { listTestCases, TESTS_SOURCE } from "@/lib/evals/test-cases";
import { FIXTURE_NOW, getFixtureAgent } from "@/lib/fixtures/runs";
import { fixtureQuality, fixtureTestCases, fixtureTestReport } from "@/lib/fixtures/tests";

export const metadata: Metadata = { title: "Tests · AgentDepot" };


/** Saved cases, publish status and the latest TestRun for the current version; `now` formats "ran … ago". */
async function loadSavedTests(ownerId: string, agentId: string) {
  const [cases, publish] = await Promise.all([listTestCases(ownerId, agentId), getPublishStatus(ownerId, agentId)]);
  const report = await latestTestReport(ownerId, agentId, publish.agentVersion);
  const quality = await getTestQuality(ownerId, agentId, publish.agentVersion, report);
  return { cases, publish, report, quality, now: Date.now() };
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) return <AuthPrompt />;
  const id = decodeURIComponent((await params).id);
  if (TESTS_SOURCE === "fixtures") {
    const agent = getFixtureAgent(id);
    return <TestsScreen agent={agent} initialCases={fixtureTestCases} report={fixtureTestReport} quality={fixtureQuality}
      tools={TOOL_IDS} now={FIXTURE_NOW} persist={false} />;
  }
  let data, agent;
  try {
    [data, agent] = await Promise.all([loadSavedTests(ownerId, id), getAgentHeader(id)]);
  } catch (error) {
    if (error instanceof Error && error.message === "agent_not_found") notFound();
    throw error;
  }
  return <TestsScreen key={`${agent.id}:${agent.version}`} agent={agent} initialCases={data.cases} report={data.report} quality={data.quality} tools={TOOL_IDS}
    now={data.now} persist publish={data.publish} />;
}

export default function TestsPage({ params }: PageProps<"/agents/[id]/tests">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-(--ad-muted)">Loading tests…</p>}>
      <Content params={params} />
    </Suspense>
  );
}
