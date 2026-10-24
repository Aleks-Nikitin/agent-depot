import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { RunStep } from "../contracts";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function authorize(request: Request): string {
  const expected = process.env.RUNTIME_API_TOKEN;
  if (!expected || expected.length < 24) throw new HttpError(503, "runtime_auth_not_configured");
  const actual = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "unauthorized");
  // Single-demo-workspace adapter. Replace with session ownership for multi-user use.
  return "demo";
}
export async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "invalid_body");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) { await reader.cancel(); throw new HttpError(413, "body_too_large"); }
      chunks.push(value);
    }
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_body");
  } finally { reader.releaseLock(); }
}
export function httpError(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  const reason = error instanceof Error ? error.message : "";
  if (["agent_not_found", "run_not_found", "approval_not_found"].includes(reason)) return Response.json({ error: "not_found" }, { status: 404 });
  if (["approval_unavailable", "run_unavailable"].includes(reason)) return Response.json({ error: reason }, { status: 409 });
  return Response.json({ error: "runtime_unavailable" }, { status: 503 });
}
export function streamRun(request: Request, task: (signal: AbortSignal, emit: (event: RunStep) => void) => Promise<unknown>) {
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(writer) {
      void Promise.resolve().then(() => task(signal, event => {
        if (open) writer.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
      })).then(() => { if (open) { open = false; writer.close(); } }, () => {
        if (open) { open = false; writer.error(new Error("run_stream_failed")); }
      });
    },
    cancel() { open = false; controller.abort(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no",
  } });
}
