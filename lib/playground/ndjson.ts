import { RunStepSchema, type RunStep } from "@/lib/agents/contracts";

/** Buffers text and yields complete lines only. Network chunks can split a line anywhere. */
export class NdjsonDecoder {
  private buffer = "";
  push(text: string): string[] {
    this.buffer += text;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.map(l => l.trim()).filter(Boolean);
  }
  end(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

export type ParsedLine = { ok: true; event: RunStep } | { ok: false; line: string };

export function parseEventLine(line: string): ParsedLine {
  try {
    const result = RunStepSchema.safeParse(JSON.parse(line));
    return result.success ? { ok: true, event: result.data } : { ok: false, line };
  } catch {
    return { ok: false, line };
  }
}

/** Reads an NDJSON run stream to the end, emitting each valid event as soon as its line completes. */
export async function readRunStream(body: ReadableStream<Uint8Array>, onEvent: (event: RunStep) => void,
  options: { signal?: AbortSignal; onInvalidLine?: (line: string) => void } = {}): Promise<void> {
  const reader = body.getReader();
  const text = new TextDecoder();
  const lines = new NdjsonDecoder();
  const handle = (batch: string[]) => {
    for (const line of batch) {
      const parsed = parseEventLine(line);
      if (parsed.ok) onEvent(parsed.event);
      else options.onInvalidLine?.(parsed.line);
    }
  };
  const cancel = () => void reader.cancel().catch(() => {});
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      handle(lines.push(text.decode(value, { stream: true })));
    }
    handle(lines.push(text.decode()));
    handle(lines.end());
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
