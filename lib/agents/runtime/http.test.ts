import { afterEach, expect, it, vi } from "vitest";
import { authorize, readBody, streamRun } from "./http";
import { RunRequestSchema } from "../contracts";
import { eventFixtures } from "../fixtures";

afterEach(() => vi.unstubAllEnvs());
it("fails closed without demo auth and ignores caller owner headers", () => {
  vi.stubEnv("RUNTIME_API_TOKEN", "");
  expect(() => authorize(new Request("http://local"))).toThrow("runtime_auth_not_configured");
  vi.stubEnv("RUNTIME_API_TOKEN", "a-long-demo-token-for-testing");
  expect(() => authorize(new Request("http://local"))).toThrow("unauthorized");
  expect(authorize(new Request("http://local", { headers: { authorization: "Bearer a-long-demo-token-for-testing", "x-owner-id": "other" } }))).toBe("demo");
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
