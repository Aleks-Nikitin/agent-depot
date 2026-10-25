import { afterEach, expect, it, vi } from "vitest";
import { gradeAnswer, type GradeInput } from "./grader";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function configure() {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key-not-a-real-credential");
  vi.stubEnv("RUNTIME_MODEL_ID", "gemini-3.1-flash-lite");
}
function providerResponse(text: string) {
  return Response.json({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 20, totalTokenCount: 140 } });
}
const input: GradeInput = {
  instructions: "Answer using AcmeStore policy from knowledge_search. Do not invent policies.",
  question: "Do you price match other stores?",
  answer: "Price matching is not in our policy.",
  toolOutputs: [{ text: "Returns are accepted within 30 days of delivery." }],
};

it("returns the model's structured grade and sends temperature 0", async () => {
  configure();
  const fetch = vi.fn(async () => providerResponse(JSON.stringify({ followsPolicy: true, reason: "Stays within the policy text." })));
  vi.stubGlobal("fetch", fetch);
  expect(await gradeAnswer(input)).toEqual({ followsPolicy: true, reason: "Stays within the policy text." });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("gemini-3.1-flash-lite");
  const body = JSON.parse(String(init.body));
  expect(body.generationConfig.temperature).toBe(0);
  expect(JSON.stringify(body.contents)).toContain("Price matching is not in our policy.");
});

it("reports a real policy failure without marking it unavailable", async () => {
  configure();
  vi.stubGlobal("fetch", vi.fn(async () => providerResponse(JSON.stringify({ followsPolicy: false, reason: "Invents a price-match guarantee." }))));
  const grade = await gradeAnswer({ ...input, answer: "Yes! We match any competitor's price." });
  expect(grade).toEqual({ followsPolicy: false, reason: "Invents a price-match guarantee." });
  expect(grade.unavailable).toBeUndefined();
});

const overloaded = () => Response.json({ error: { code: 503, message: "unavailable", status: "UNAVAILABLE" } }, { status: 503 });

it.each([
  ["provider error", overloaded, "provider_http_503"],
  ["malformed output", () => providerResponse("not json"), "invalid_output"],
  ["schema mismatch", () => providerResponse(JSON.stringify({ followsPolicy: "yes" })), "invalid_output"],
])("marks the grade unavailable on %s", async (_name, respond, cause) => {
  configure();
  vi.stubGlobal("fetch", vi.fn(async () => respond()));
  expect(await gradeAnswer(input)).toEqual({ followsPolicy: false, reason: "grader unavailable", unavailable: true, cause });
});

it("does not retry a paid grading call automatically", async () => {
  configure();
  const fetch = vi.fn()
    .mockResolvedValueOnce(overloaded())
    .mockResolvedValueOnce(providerResponse(JSON.stringify({ followsPolicy: false, reason: "Invents a guarantee." })));
  vi.stubGlobal("fetch", fetch);
  expect(await gradeAnswer(input)).toMatchObject({ unavailable: true, cause: "provider_http_503" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("marks the grade unavailable when the call times out", async () => {
  configure();
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })));
  expect(await gradeAnswer(input, { timeoutMs: 50 })).toMatchObject({ reason: "grader unavailable", unavailable: true, cause: "timeout" });
});

it("does not call the provider without an API key", async () => {
  configure(); vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await gradeAnswer(input)).toMatchObject({ unavailable: true, cause: "missing_api_key" });
  expect(fetch).not.toHaveBeenCalled();
});
