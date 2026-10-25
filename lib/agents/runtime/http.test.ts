import { afterEach, expect, it, vi } from "vitest";
import { authorize, readBody, streamRun } from "./http";
import { RunRequestSchema } from "../contracts";
import { eventFixtures } from "../fixtures";

afterEach(() => vi.unstubAllEnvs());
it("requires explicit local demo auth and ignores caller owner headers", async () => {
  vi.stubEnv("RUNTIME_ALLOW_DEMO_TOKEN", "true");
  const authorized = new Request("http://local", { headers: { authorization: "Bearer a-long-demo-token-for-testing", "x-owner-id": "other" } });
  vi.stubEnv("RUNTIME_API_TOKEN", "");
  await expect(authorize(authorized)).rejects.toThrow("runtime_auth_not_configured");
  vi.stubEnv("RUNTIME_API_TOKEN", "a-long-demo-token-for-testing");
  await expect(authorize(new Request("http://local"))).rejects.toThrow("unauthorized");
  expect(await authorize(authorized)).toBe("demo");
  vi.stubEnv("RUNTIME_ALLOW_DEMO_TOKEN", "false");
  await expect(authorize(authorized)).rejects.toThrow("unauthorized");
  vi.stubEnv("RUNTIME_ALLOW_DEMO_TOKEN", "true"); vi.stubEnv("NODE_ENV", "production");
  await expect(authorize(authorized)).rejects.toThrow("demo_auth_disabled");
});
it("rejects oversized bodies and client policy overrides", async () => {
  await expect(readBody(new Request("http://local", { method: "POST", body: "x".repeat(17000) }), RunRequestSchema)).rejects.toThrow("body_too_large");
  await expect(readBody(new Request("http://local", { method: "POST", body: JSON.stringify({ message: "test", approvalMode: "allow" }) }), RunRequestSchema)).rejects.toThrow("invalid_body");
});
it("delivers events before task completion and closes as NDJSON", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const response = streamRun(new Request("http://local"), async (_signal, emit) => {
    emit(eventFixtures.success[0]); await waiting; emit(eventFixtures.success.at(-1)!);
  });
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(JSON.parse(new TextDecoder().decode(first.value)).type).toBe("run_started");
  release();
  expect(JSON.parse(new TextDecoder().decode((await reader.read()).value)).type).toBe("run_completed");
  expect((await reader.read()).done).toBe(true);
});

it("bounds incomplete request bodies with a deadline and cancels their source", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(writer) { writer.enqueue(new TextEncoder().encode('{"message":')); }, cancel,
  });
  const request = new Request("http://local", { method: "POST", body, duplex: "half" } as RequestInit);
  await expect(readBody(request, RunRequestSchema, 20)).rejects.toMatchObject({ status: 408, message: "body_timeout" });
  expect(cancel).toHaveBeenCalledOnce();
});
it("aborts body reads on disconnect instead of waiting for the body timeout", async () => {
  const controller = new AbortController(); const cancel = vi.fn();
  const request = new Request("http://local", {
    method: "POST", body: new ReadableStream<Uint8Array>({ cancel }), signal: controller.signal, duplex: "half",
  } as RequestInit);
  const reading = readBody(request, RunRequestSchema);
  controller.abort();
  await expect(reading).rejects.toMatchObject({ status: 408, message: "request_aborted" });
  expect(cancel).toHaveBeenCalledOnce();
});
it("returns the size error even if the request source never acknowledges cancellation", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(writer) { writer.enqueue(new Uint8Array(17_000)); }, cancel() { return new Promise(() => {}); },
  });
  await expect(readBody(new Request("http://local", { method: "POST", body, duplex: "half" } as RequestInit), RunRequestSchema))
    .rejects.toMatchObject({ status: 413, message: "body_too_large" });
});
it("does not start execution for an already disconnected request", async () => {
  const controller = new AbortController(); controller.abort();
  const task = vi.fn(async () => {});
  const response = streamRun(new Request("http://local", { signal: controller.signal }), task);
  await expect(response.text()).rejects.toThrow("run_stream_failed");
  expect(task).not.toHaveBeenCalled();
});
it("hands cancellation to an already-started run so it can settle durable state", async () => {
  const controller = new AbortController(); controller.abort();
  const task = vi.fn(async (signal: AbortSignal) => { expect(signal.aborted).toBe(true); });
  const response = streamRun(new Request("http://local", { signal: controller.signal }), task, { alreadyStarted: true });
  await response.text();
  expect(task).toHaveBeenCalledOnce();
});
it("propagates response-reader cancellation to the active runtime", async () => {
  let activeSignal!: AbortSignal;
  const response = streamRun(new Request("http://local"), async (signal, emit) => {
    activeSignal = signal; emit(eventFixtures.success[0]);
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  });
  const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
  expect(activeSignal.aborted).toBe(true);
});
