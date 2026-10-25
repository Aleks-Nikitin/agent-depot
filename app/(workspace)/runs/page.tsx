import { pageOwnerOrNull } from "@/lib/auth/session";
import type { Metadata } from "next";
import { Suspense } from "react";
import { MetricCards } from "@/components/runs/metric-cards";
import { RunsTable } from "@/components/runs/runs-table";
import { SuccessChart } from "@/components/runs/success-chart";
import { ButtonLink } from "@/components/ui/button";
import { PlayIcon } from "@/components/ui/icons";
import { computeMetrics, successSeries } from "@/lib/runs/metrics";
import { listRuns } from "@/lib/runs/queries";

export const metadata: Metadata = { title: "Runs · AgentDepot" };

async function RunsContent() {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) return null;
  const { runs, now, nextCursor } = await listRuns(ownerId);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.7fr)]">
        <MetricCards metrics={computeMetrics(runs)} />
        <SuccessChart series={successSeries(runs)} className="flex flex-col p-5 sm:col-span-2 xl:col-span-1" />
      </div>
      <p className="text-xs text-(--ad-muted)">Overview reflects the latest {runs.length} playground runs.</p>
      <RunsTable runs={runs} now={now} nextCursor={nextCursor} />
    </>
  );
}

export default function RunsPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">Runs</h1>
          <p className="mt-1 text-sm text-(--ad-muted)">Every run, tagged by agent version</p>
        </div>
        <ButtonLink href="/playground" variant="primary"><PlayIcon size={14} /> Trigger run</ButtonLink>
      </div>
      <Suspense fallback={<p className="text-sm text-(--ad-muted)">Loading runs…</p>}>
        <RunsContent />
      </Suspense>
    </div>
  );
}
