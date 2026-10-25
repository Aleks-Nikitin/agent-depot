import type { RunStep, Usage } from "@/lib/agents/contracts";
import type { RunStatus } from "@/lib/runs/format";

export type ModelItem = {
  kind: "model"; id: string; sequence: number; step: number; status: "running" | "done";
  usage: Usage | null; tokens: number | null; durationMs: number | null;
};
export type ToolItem = {
  kind: "tool"; id: string; sequence: number; toolId: string; input: unknown;
  status: "requested" | "awaiting_approval" | "running" | "succeeded" | "failed" | "denied";
  output: unknown; reason: string | null; durationMs: number | null;
};
export type ApprovalItem = {
  kind: "approval"; id: string; sequence: number; toolCallId: string; toolId: string; input: unknown;
  expiresAt: string; decision: "pending" | "approved" | "rejected";
};
export type OutcomeItem = {
  kind: "outcome"; id: string; sequence: number; status: "completed" | "blocked" | "failed";
  response: string | null; reason: string | null;
};
export type TraceItem = ModelItem | ToolItem | ApprovalItem | OutcomeItem;

export type TraceTotals = {
  /** null means at least one step did not report usage: show "unknown", not zero. */
  tokens: number | null;
  costUsd: number | null;
  /** Active time; time spent waiting for a human is excluded. */
  durationMs: number | null;
  modelCalls: number;
  toolCalls: number;
  errors: number;
};

export type Trace = {
  runId: string | null;
  agentId: string | null;
  /** Deduplicated by eventId and sorted by sequence. */
  events: RunStep[];
  items: TraceItem[];
  status: RunStatus | null;
  response: string | null;
  stopReason: string | null;
  pendingApproval: ApprovalItem | null;
  totals: TraceTotals;
  lastSequence: number;
  /** Sequence numbers we have not seen yet; fetch history after a gap to fill them. */
  missingSequences: number[];
};

export const emptyTrace: Trace = deriveTrace([]);

/** Merges incoming events into a trace. Duplicates (same eventId, or same sequence) are ignored. */
export function addEvents(trace: Trace, incoming: RunStep[]): Trace {
  const ids = new Set(trace.events.map(e => e.eventId));
  const seqs = new Set(trace.events.map(e => e.sequence));
  const runId = trace.runId ?? incoming[0]?.runId ?? null;
  const fresh: RunStep[] = [];
  for (const e of incoming) {
    if (e.runId !== runId || ids.has(e.eventId) || seqs.has(e.sequence)) continue;
    ids.add(e.eventId); seqs.add(e.sequence); fresh.push(e);
  }
  return fresh.length ? deriveTrace([...trace.events, ...fresh]) : trace;
}

const sum = (a: number | null, b: number | null) => (a == null || b == null ? null : a + b);
const usageTokens = (u: Usage) => sum(u.inputTokens, u.outputTokens);
const elapsed = (from: string, to: string) => Math.max(0, Date.parse(to) - Date.parse(from));

export function deriveTrace(input: RunStep[]): Trace {
  const events = [...input].sort((a, b) => a.sequence - b.sequence);
  const items: TraceItem[] = [];
  const tools = new Map<string, ToolItem>();
  const approvals = new Map<string, ApprovalItem>();
  let model: ModelItem | null = null;
  let modelStartedAt: string | null = null;
  let completed: Extract<RunStep, { type: "run_completed" }> | null = null;
  let pausedAt: string | null = null;
  let waitedMs = 0;
  let agentId: string | null = null;
  let errors = 0;

  const toolStartedAt = new Map<string, string>();
  const tool = (e: { sequence: number }, p: { toolCallId: string; toolId: string; input?: unknown }) => {
    let t = tools.get(p.toolCallId);
    if (!t) {
      t = { kind: "tool", id: p.toolCallId, sequence: e.sequence, toolId: p.toolId, input: p.input,
        status: "requested", output: undefined, reason: null, durationMs: null };
      tools.set(p.toolCallId, t); items.push(t);
    }
    return t;
  };

  for (const e of events) {
    switch (e.type) {
      case "run_started": agentId = e.payload.agentId; break;
      case "model_started":
        model = { kind: "model", id: e.eventId, sequence: e.sequence, step: e.payload.step, status: "running",
          usage: null, tokens: null, durationMs: null };
        modelStartedAt = e.timestamp; items.push(model); break;
      case "model_finished":
        if (!model || model.status === "done") {
          model = { kind: "model", id: e.eventId, sequence: e.sequence, step: 0, status: "running", usage: null, tokens: null, durationMs: null };
          items.push(model); modelStartedAt = null;
        }
        model.status = "done"; model.usage = e.payload; model.tokens = usageTokens(e.payload);
        model.durationMs = modelStartedAt ? elapsed(modelStartedAt, e.timestamp) : null; break;
      case "tool_requested": tool(e, e.payload); break;
      case "tool_started": tool(e, e.payload).status = "running"; toolStartedAt.set(e.payload.toolCallId, e.timestamp); break;
      case "tool_finished": {
        const t = tool(e, e.payload);
        t.status = "succeeded"; t.output = e.payload.output; t.durationMs = e.payload.durationMs; break;
      }
      case "tool_failed": {
        const t = tool(e, e.payload);
        t.reason = e.payload.reason;
        t.status = e.payload.reason === "write_denied" ? "denied" : "failed";
        const startedAt = toolStartedAt.get(e.payload.toolCallId);
        if (startedAt) t.durationMs = elapsed(startedAt, e.timestamp);
        if (t.status === "failed") errors++;
        break;
      }
      case "approval_required": {
        tool(e, e.payload).status = "awaiting_approval";
        const a: ApprovalItem = { kind: "approval", id: e.payload.approvalId, sequence: e.sequence, toolCallId: e.payload.toolCallId,
          toolId: e.payload.toolId, input: e.payload.input, expiresAt: e.payload.expiresAt, decision: "pending" };
        approvals.set(a.id, a); items.push(a); pausedAt = e.timestamp; break;
      }
      case "approval_resolved": {
        const a = approvals.get(e.payload.approvalId);
        if (a) a.decision = e.payload.approved ? "approved" : "rejected";
        const t = tools.get(e.payload.toolCallId);
        if (t) t.status = e.payload.approved ? "requested" : "denied";
        if (pausedAt) { waitedMs += elapsed(pausedAt, e.timestamp); pausedAt = null; }
        break;
      }
      case "run_blocked":
        items.push({ kind: "outcome", id: e.eventId, sequence: e.sequence, status: "blocked", response: null, reason: e.payload.reason }); break;
      case "run_failed":
        errors++;
        items.push({ kind: "outcome", id: e.eventId, sequence: e.sequence, status: "failed", response: null, reason: e.payload.reason }); break;
      case "run_completed":
        completed = e;
        items.push({ kind: "outcome", id: e.eventId, sequence: e.sequence, status: "completed", response: e.payload.response, reason: null }); break;
    }
  }

  const outcome = [...items].reverse().find((i): i is OutcomeItem => i.kind === "outcome") ?? null;
  const pendingApproval = outcome ? null : [...approvals.values()].find(a => a.decision === "pending") ?? null;
  const rejectedAny = [...approvals.values()].some(a => a.decision === "rejected");
  const status: RunStatus | null = !events.length ? null
    : outcome ? (outcome.status === "completed" && rejectedAny ? "rejected" : outcome.status)
    : pendingApproval ? "waiting_approval" : "running";

  // A model call that never finished in an ended run may still be billed: its usage is unknown, not zero.
  const models = items.filter((i): i is ModelItem => i.kind === "model" && (i.status === "done" || !!outcome));
  const modelTokens = models.reduce<number | null>((acc, m) => sum(acc, m.tokens), 0);
  const modelCost = models.reduce<number | null>((acc, m) => sum(acc, m.usage?.estimatedCostUsd ?? null), 0);
  const first = events[0], last = events[events.length - 1];
  const totals: TraceTotals = {
    tokens: completed ? usageTokens(completed.payload.usage) : modelTokens,
    costUsd: completed ? completed.payload.usage.estimatedCostUsd : modelCost,
    durationMs: completed ? completed.payload.durationMs
      : first && last ? elapsed(first.timestamp, pausedAt ?? last.timestamp) - waitedMs : null,
    modelCalls: items.filter(i => i.kind === "model").length,
    toolCalls: tools.size,
    errors,
  };

  const lastSequence = last?.sequence ?? 0;
  const seen = new Set(events.map(e => e.sequence));
  const missingSequences: number[] = [];
  for (let s = 1; s < lastSequence; s++) if (!seen.has(s)) missingSequences.push(s);

  return {
    runId: first?.runId ?? null, agentId, events, items, status,
    response: outcome?.response ?? null, stopReason: outcome?.reason ?? null,
    pendingApproval, totals, lastSequence, missingSequences,
  };
}

/** Pending approvals past their deadline can no longer be claimed; show them as expired. */
export function approvalState(item: ApprovalItem, now: number = Date.now()): ApprovalItem["decision"] | "expired" {
  return item.decision === "pending" && Date.parse(item.expiresAt) <= now ? "expired" : item.decision;
}

/**
 * One-line summary of a model step, from what happened after it. Events carry no model text by design
 * (no private reasoning), so this is derived. PLACEHOLDER(P17).
 */
export function describeModelStep(items: TraceItem[], index: number): string {
  const m = items[index];
  if (m?.kind !== "model") return "";
  if (m.status === "running") return "Thinking…";
  const after: TraceItem[] = [];
  for (let i = index + 1; i < items.length && items[i].kind !== "model"; i++) after.push(items[i]);
  const tools = [...new Set(after.filter((i): i is ToolItem => i.kind === "tool").map(t => t.toolId))];
  const approval = after.find((i): i is ApprovalItem => i.kind === "approval");
  const outcome = after.find((i): i is OutcomeItem => i.kind === "outcome");
  if (approval) return `Proposed ${approval.toolId}, which needs human approval.`;
  if (tools.length) return `Requested ${tools.join(", ")}.`;
  if (outcome?.status === "completed") return "Wrote the final answer.";
  if (outcome?.status === "blocked") return "Wanted to continue, but a guardrail stopped the run.";
  if (outcome?.status === "failed") return "The run failed after this step.";
  return "Finished this step.";
}
