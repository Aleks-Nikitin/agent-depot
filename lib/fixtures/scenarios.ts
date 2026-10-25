import { RunStepSchema, type RunStep } from "@/lib/agents/contracts";

// FIXTURE DATA. Deterministic timing, tokens and costs that mirror the design mock-ups.
// Every event is validated against the runtime contract, so the UI never sees an invented format.
// PLACEHOLDER(P4): send_email and google_shopping are Dev 4 tools that are not in the registry yet
// (today's write tool is create_ticket). The UI renders any toolId, so only the fixtures change.

export const FIXTURE_AGENT_SUPPORT = "acmestore-support";
export const FIXTURE_AGENT_PRICING = "competitor-pricing";

class Script {
  constructor(readonly runId: string, private t: number, private seq = 0, readonly events: RunStep[] = []) {}
  add(type: RunStep["type"], payload: unknown, afterMs = 0) {
    this.t += afterMs; this.seq += 1;
    this.events.push(RunStepSchema.parse({ schemaVersion: 1, eventId: `fx-${this.runId}-${this.seq}`, runId: this.runId,
      sequence: this.seq, timestamp: new Date(this.t).toISOString(), type, payload }));
    return this;
  }
  model(step: number, inputTokens: number, outputTokens: number, costUsd: number, ms: number) {
    return this.add("model_started", { step }, 20).add("model_finished", { inputTokens, outputTokens, estimatedCostUsd: costUsd }, ms);
  }
  tool(toolCallId: string, toolId: string, input: unknown, output: unknown, ms: number) {
    const call = { toolCallId, toolId, input };
    return this.add("tool_requested", call, 5).add("tool_started", call, 5)
      .add("tool_finished", { toolCallId, toolId, output, durationMs: ms }, ms);
  }
  /** Continue the same run (same id, increasing sequence) on an independent copy. */
  fork() { return new Script(this.runId, this.t, this.seq, [...this.events]); }
}

export type Scenario = {
  agentId: string;
  message: string;
  events: RunStep[];
  /** Present when the scenario pauses: the events emitted after approve / reject. */
  continuation?: { approvalId: string; approve: RunStep[]; reject: RunStep[] };
};

export type ScenarioKey = "returnPolicy" | "shippingTime" | "refundApproval" | "competitorPricing" | "stepLimit" | "budgetLimit" | "providerFailure" | "toolFailure";

const usage = (inputTokens: number, outputTokens: number, estimatedCostUsd: number) => ({ inputTokens, outputTokens, estimatedCostUsd });

const builders: Record<ScenarioKey, (runId: string, startMs: number) => Scenario> = {
  returnPolicy(runId, t) {
    const message = "Can I return a jacket after 20 days?";
    const s = new Script(runId, t).add("run_started", { agentId: FIXTURE_AGENT_SUPPORT })
      .model(1, 310, 92, 0.0005, 700)
      .tool("call-1", "knowledge_search", { query: "return policy jackets" },
        { text: "Items can be returned within 30 days of delivery if unworn with tags attached." }, 180)
      .model(2, 420, 120, 0.0007, 1100);
    s.add("run_completed", { response: "Yes. AcmeStore accepts returns within 30 days of delivery, so a jacket at 20 days is still eligible as long as it's unworn with tags attached.",
      durationMs: 2100, usage: usage(730, 212, 0.0012) }, 60);
    return { agentId: FIXTURE_AGENT_SUPPORT, message, events: s.events };
  },

  shippingTime(runId, t) {
    const message = "How long does shipping take?";
    const s = new Script(runId, t).add("run_started", { agentId: FIXTURE_AGENT_SUPPORT })
      .model(1, 290, 80, 0.0004, 600)
      .tool("call-1", "knowledge_search", { query: "shipping times" },
        { text: "Standard shipping takes 3–5 business days. Express takes 1–2 business days." }, 160)
      .model(2, 400, 110, 0.0007, 950);
    s.add("run_completed", { response: "Standard shipping takes 3–5 business days, and express shipping takes 1–2 business days.",
      durationMs: 1800, usage: usage(690, 190, 0.0011) }, 50);
    return { agentId: FIXTURE_AGENT_SUPPORT, message, events: s.events };
  },

  refundApproval(runId, t) {
    const message = "Refund order 1042";
    const email = { to: "customer-1042@example.com", subject: "Your refund for order 1042",
      body: "Hi, your refund for order 1042 has been approved and will go back to your original payment method within 5–7 business days." };
    const s = new Script(runId, t).add("run_started", { agentId: FIXTURE_AGENT_SUPPORT })
      .model(1, 400, 112, 0.0008, 700)
      .tool("call-1", "knowledge_search", { query: "refund policy" },
        { text: "Refunds are issued to the original payment method after manager approval…" }, 180)
      .model(2, 540, 152, 0.0011, 900)
      .add("tool_requested", { toolCallId: "call-2", toolId: "send_email", input: email }, 5)
      .add("approval_required", { toolCallId: "call-2", toolId: "send_email", input: email, approvalId: `${runId}-approval-1`,
        expiresAt: new Date(t + 15 * 60_000).toISOString() }, 5);
    const resumeAt = 4000;
    const approve = s.fork()
      .add("approval_resolved", { approvalId: `${runId}-approval-1`, approved: true, toolCallId: "call-2" }, resumeAt)
      .add("tool_started", { toolCallId: "call-2", toolId: "send_email", input: email }, 5)
      .add("tool_finished", { toolCallId: "call-2", toolId: "send_email", output: { status: "logged", messageId: "msg-1042" }, durationMs: 40 }, 40)
      .model(3, 620, 64, 0.0007, 600);
    approve.add("run_completed", { response: "Done. I've emailed the customer to confirm the refund for order 1042.",
      durationMs: 2500, usage: usage(1560, 328, 0.0026) }, 40);
    const reject = s.fork()
      .add("approval_resolved", { approvalId: `${runId}-approval-1`, approved: false, toolCallId: "call-2" }, resumeAt)
      .add("tool_failed", { toolCallId: "call-2", toolId: "send_email", reason: "write_denied" }, 5)
      .model(3, 610, 70, 0.0007, 600);
    reject.add("run_completed", { response: "I didn't send the refund email because it wasn't approved. A manager can review the request.",
      durationMs: 2400, usage: usage(1550, 334, 0.0026) }, 40);
    const n = s.events.length;
    return { agentId: FIXTURE_AGENT_SUPPORT, message, events: s.events,
      continuation: { approvalId: `${runId}-approval-1`, approve: approve.events.slice(n), reject: reject.events.slice(n) } };
  },

  competitorPricing(runId, t) {
    const message = "Are we priced above competitors on our top 3 products?";
    const s = new Script(runId, t).add("run_started", { agentId: FIXTURE_AGENT_PRICING })
      .model(1, 520, 120, 0.0010, 800)
      .tool("call-1", "sales_lookup", { top: 3 }, [
        { product: "Trail Jacket", price: 129, unitsSold: 412 },
        { product: "Merino Hoodie", price: 89, unitsSold: 388 },
        { product: "Rain Shell", price: 149, unitsSold: 301 },
      ], 40)
      .model(2, 930, 190, 0.0017, 1100)
      .add("tool_requested", { toolCallId: "call-2", toolId: "google_shopping", input: { q: "Trail Jacket" } }, 5)
      .add("tool_started", { toolCallId: "call-2", toolId: "google_shopping", input: { q: "Trail Jacket" } }, 5)
      .add("tool_failed", { toolCallId: "call-2", toolId: "google_shopping", reason: "SerpApi request timed out. Model retried." }, 2000)
      .tool("call-3", "google_shopping", { q: "Trail Jacket" }, { competitors: [{ store: "PeakGear", price: 119 }, { store: "NorthLine", price: 124 }] }, 1400)
      .model(3, 2410, 440, 0.0047, 1500);
    s.add("run_completed", { response: "Yes on 2 of 3. Trail Jacket ($129) is $5–10 above PeakGear and NorthLine; Rain Shell is about 6% above the market median. Merino Hoodie is priced in line.",
      durationMs: 6800, usage: usage(3860, 750, 0.0074) }, 30);
    return { agentId: FIXTURE_AGENT_PRICING, message, events: s.events };
  },

  stepLimit(runId, t) {
    const message = "Keep checking the policy until you are completely sure.";
    const s = new Script(runId, t).add("run_started", { agentId: FIXTURE_AGENT_SUPPORT });
    for (let i = 1; i <= 4; i++) s.model(i, 300 + i * 40, 60, 0.0004, 600).tool(`call-${i}`, "knowledge_search", { query: `returns (pass ${i})` }, { text: "Returns within 30 days." }, 150);
    s.model(5, 520, 60, 0.0006, 600).add("run_blocked", { reason: "step_limit" }, 10);
    return { agentId: FIXTURE_AGENT_SUPPORT, message, events: s.events };
  },

  budgetLimit(runId, t) {
    const message = "Compare prices across all 20 products";
    const s = new Script(runId, t).add("run_started", { agentId: FIXTURE_AGENT_PRICING })
      .model(1, 600, 140, 0.0012, 900)
      .tool("call-1", "sales_lookup", { top: 20 }, { rows: 20 }, 60)
      .model(2, 9800, 480, 0.2388, 8300)
      .add("run_blocked", { reason: "budget_limit" }, 10);
    return { agentId: FIXTURE_AGENT_PRICING, message, events: s.events };
  },

  providerFailure(runId, t) {
    const message = "How long does shipping take?";
    const s = new Script(runId, t).add("run_started", { agentId: FIXTURE_AGENT_SUPPORT })
      .add("model_started", { step: 1 }, 20)
      .add("run_failed", { reason: "execution_failed" }, 1200);
    return { agentId: FIXTURE_AGENT_SUPPORT, message, events: s.events };
  },

  toolFailure(runId, t) {
    const message = "What do competitors charge for the Rain Shell?";
    const s = new Script(runId, t).add("run_started", { agentId: FIXTURE_AGENT_PRICING })
      .model(1, 480, 90, 0.0008, 700)
      .add("tool_requested", { toolCallId: "call-1", toolId: "google_shopping", input: { q: "Rain Shell" } }, 5)
      .add("tool_started", { toolCallId: "call-1", toolId: "google_shopping", input: { q: "Rain Shell" } }, 5)
      .add("tool_failed", { toolCallId: "call-1", toolId: "google_shopping", reason: "upstream_unavailable" }, 2000)
      .add("run_failed", { reason: "execution_failed" }, 10);
    return { agentId: FIXTURE_AGENT_PRICING, message, events: s.events };
  },
};

export const scenarioKeys = Object.keys(builders) as ScenarioKey[];

/** Fixed epoch so fixtures are deterministic in tests; the mock client passes its own clock. */
export const FIXTURE_EPOCH = Date.parse("2026-10-24T18:00:00.000Z");

export function buildScenario(key: ScenarioKey, runId = `fixture-${key}`, startMs = FIXTURE_EPOCH): Scenario {
  return builders[key](runId, startMs);
}

/** Routes a typed playground message to a scenario, so the demo flow works without a backend. */
export function pickScenario(message: string): ScenarioKey {
  const m = message.toLowerCase();
  if (m.includes("refund")) return "refundApproval";
  if (m.includes("all 20") || m.includes("budget")) return "budgetLimit";
  if (m.includes("until") || m.includes("step limit")) return "stepLimit";
  if (m.includes("rain shell") || m.includes("tool fail")) return "toolFailure";
  if (m.includes("compet") || m.includes("price")) return "competitorPricing";
  if (m.includes("provider") || m.includes("outage")) return "providerFailure";
  if (m.includes("shipping")) return "shippingTime";
  return "returnPolicy";
}
