import { describe, expect, it } from "vitest";
import type { RunStep } from "@/lib/agents/contracts";
import { buildScenario } from "@/lib/fixtures/scenarios";
import { NdjsonDecoder, readRunStream } from "./ndjson";

function streamOf(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({ start(c) { chunks.forEach(x => c.enqueue(enc.encode(x))); c.close(); } });
}

describe("NDJSON parsing", () => {
  it("only yields complete lines, however the chunks are cut", () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"a":')).toEqual([]);
    expect(d.push('1}\n{"b"')).toEqual(['{"a":1}']);
    expect(d.push(":2}\r\n\n")).toEqual(['{"b":2}']);
    expect(d.push('{"c":3}')).toEqual([]);
    expect(d.end()).toEqual(['{"c":3}']);
  });

  it("decodes events split mid-line and mid multi-byte character", async () => {
    const events = buildScenario("refundApproval").events;
    const text = events.map(e => JSON.stringify(e)).join("\n") + "\n";
    const bytes = new TextEncoder().encode(text);
    // 7-byte chunks will split the "–" in the email body across chunks.
    const stream = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
    const seen: RunStep[] = [];
    await readRunStream(stream, e => seen.push(e));
    expect(seen).toEqual(events);
  });

  it("skips invalid lines without dropping valid ones", async () => {
    const [first] = buildScenario("returnPolicy").events;
    const invalid: string[] = [];
    const seen: RunStep[] = [];
    await readRunStream(streamOf(["not json\n", '{"type":"made_up"}\n', JSON.stringify(first)]), e => seen.push(e), { onInvalidLine: l => invalid.push(l) });
    expect(seen).toEqual([first]);
    expect(invalid).toHaveLength(2);
  });
});
