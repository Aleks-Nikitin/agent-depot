import { pageOwnerOrNull } from "@/lib/auth/session";
import type { Metadata } from "next";
import { Suspense } from "react";
import { TestsScreen } from "@/components/tests/summary-card";
import { FIXTURE_NOW, FIXTURE_TOOLS, getFixtureAgent } from "@/lib/fixtures/runs";
import { fixtureQuality, fixtureTestCases, fixtureTestReport } from "@/lib/fixtures/tests";

export const metadata: Metadata = { title: "Tests · AgentDepot" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  if (!await pageOwnerOrNull()) return null;
  const { id } = await params;
  const agent = getFixtureAgent(decodeURIComponent(id));
  // PLACEHOLDER(P8): fixture cases and report for every agent until TestCase / TestRun exist.
  return <TestsScreen agent={agent} initialCases={fixtureTestCases} report={fixtureTestReport} quality={fixtureQuality}
    tools={FIXTURE_TOOLS} now={FIXTURE_NOW} />;
}

export default function TestsPage({ params }: PageProps<"/agents/[id]/tests">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-(--ad-muted)">Loading tests…</p>}>
      <Content params={params} />
    </Suspense>
  );
}
