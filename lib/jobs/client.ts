import type { TestRunReport } from "@/lib/evals/types";

/** Read-only polling survives navigation by rediscovering the owned active job on the server. */
export async function waitForEvaluation(jobId: string, signal: AbortSignal, onStatus: (status: string) => void): Promise<TestRunReport> {
  while (!signal.aborted) {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("Could not read the background evaluation. Refresh to reconnect.");
    const job = await response.json() as { status: string; result?: TestRunReport; reason?: string };
    onStatus(job.status);
    if (job.status === "completed" && job.result) return job.result;
    if (["failed", "cancelled"].includes(job.status)) throw new Error(job.status === "cancelled" ? "Evaluation cancelled." : "Evaluation stopped. Run tests again after checking worker availability.");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  signal.throwIfAborted(); throw new Error("Evaluation viewer disconnected");
}
