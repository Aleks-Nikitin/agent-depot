import { afterEach, expect, it, vi } from "vitest";
import { eventFixtures } from "@/lib/agents/fixtures";
import { createHttpRunClient } from "./http-client";

afterEach(() => vi.unstubAllGlobals());
it("follows an accepted receipt and reconnects from the last delivered sequence without submitting another run", async () => {
  const events = eventFixtures.success; const received: typeof events = []; const requests: string[] = [];
  let accepted = ""; let subscriptions = 0; let submissions = 0;
  const fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    requests.push(input);
    if (options?.method === "POST") {
      submissions++; expect(new Headers(options.headers).get("Idempotency-Key")).toBeTruthy();
      return Response.json({ jobId: "job", runId: events[0].runId }, { status: 202 });
    }
    if (input.includes("/events?")) {
      if (subscriptions++ === 0) {
        let read = false;
        return new Response(new ReadableStream({ pull(controller) {
          if (!read) { read = true; controller.enqueue(new TextEncoder().encode(JSON.stringify(events[0]) + "\n")); }
          else controller.error(new Error("viewer connection dropped"));
        } }));
      }
      return new Response(events.slice(1).map(e => JSON.stringify(e)).join("\n") + "\n");
    }
    return Response.json({ runId: events[0].runId, agentId: "support-demo", status: "completed", response: "Done", stopReason: null,
      usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.00001 }, events: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  const outcome = await createHttpRunClient().startRun({ agentId: "support-demo", message: "Run", onAccepted: id => { accepted = id; } }, e => received.push(e));
  expect(accepted).toBe(events[0].runId); expect(outcome.status).toBe("completed"); expect(received).toEqual(events);
  expect(requests).toContain(`/api/runs/${events[0].runId}/events?after=${events[0].sequence}`);
  expect(submissions).toBe(1);
});
