import { randomUUID } from "node:crypto";
import { Client } from "langsmith";
import { RunTree } from "langsmith/run_trees";
import { withRunTree } from "langsmith/traceable";
import type { AgentRunResult } from "../contracts";

// This context client has no network transport, including capability discovery.
// Only the separately allowlisted terminal metadata request below can leave.
const privateClient = new Client({ apiKey: "tracing-disabled", hideInputs: true, hideOutputs: true,
  omitTracedRuntimeInfo: true, autoBatchTracing: false, fetchImplementation: async () => Response.json({}) });

// Suppress native prompt/tool capture at the SDK boundary, even with V2 enabled.
export function withoutPayloadTracing<T>(fn: () => Promise<T>) {
  return withRunTree(new RunTree({ name: "private-execution", run_type: "chain", inputs: {}, client: privateClient, tracingEnabled: false }), fn);
}
export function traceRunMetadata(result: AgentRunResult, started: number) {
  return sendMetadata(result.runId, "agent-execution", { status: result.status, inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens, estimatedCostUsd: result.usage.estimatedCostUsd }, started);
}
export function traceRepairMetadata(caseId: string, status: string, childJobId: string | null, appliedVersion: number | null, suiteCount: number, started: number) {
  const node = status === "review" ? "interrupt_for_human_review" : status === "evaluating" ? "await_evaluation" : "report";
  return sendMetadata(randomUUID(), "repair-step", { caseId, graphVersion: 1, node, status, childJobId, appliedVersion, suiteCount }, started);
}
async function sendMetadata(id: string, name: string, metadata: Record<string, string | number | null>, started: number) {
  const key = process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY;
  if (process.env.LANGCHAIN_TRACING_V2 !== "true" || !key) return;
  try {
    const endpoint = new URL(process.env.LANGSMITH_ENDPOINT ?? process.env.LANGCHAIN_ENDPOINT ?? "https://api.smith.langchain.com");
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return;
    // The installed Client.createRun hardcodes retries even when maxRetries=0.
    // Send only our allowlisted metadata through its documented run-ingest API.
    await fetch(new URL("runs", endpoint.href.endsWith("/") ? endpoint : `${endpoint.href}/`), {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": key },
      signal: AbortSignal.timeout(500),
      body: JSON.stringify({ id, name, run_type: "chain", inputs: {}, outputs: {},
        start_time: new Date(started).toISOString(), end_time: new Date().toISOString(),
        session_name: process.env.LANGSMITH_PROJECT ?? process.env.LANGCHAIN_PROJECT ?? "default",
        extra: { metadata },
      }),
    });
  } catch { /* Optional telemetry never supplies execution evidence. */ }
}
