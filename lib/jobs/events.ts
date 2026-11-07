import { setTimeout } from "node:timers/promises";
import { PrismaRunStore } from "@/lib/agents/storage/prisma-store";
import { getDb } from "@/lib/db/prisma";

/** A disconnected reader stops polling only; worker cancellation is an explicit mutation. */
export async function persistedRunStream(request: Request, runId: string, ownerId: string, after: number) {
  const store = new PrismaRunStore(getDb());
  await store.loadRun(runId, ownerId); // Ownership errors precede response headers.
  let open = true; const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(25_000)]);
  const stream = new ReadableStream<Uint8Array>({
    start(writer) {
      void (async () => {
        try {
          while (!signal.aborted && open) {
            const history = await store.history(runId, ownerId, after);
            for (const event of history.events) {
              if (signal.aborted || !open) break;
              writer.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n")); after = event.sequence;
            }
            if (history.status !== "running") break;
            await setTimeout(200, undefined, { signal });
          }
        } catch { /* Reconnect to persisted sequence; never mutate execution from this read. */ }
        finally { if (open) { open = false; writer.close(); } }
      })();
    },
    cancel() { open = false; controller.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store", "X-Accel-Buffering": "no" } });
}
