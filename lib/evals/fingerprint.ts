import { createHash } from "node:crypto";

export function testFingerprint(cases: { id: string; input: string; mustCall: string[]; mustNotCall: string[];
  mustContain: string[]; useGrader: boolean; expectedBehavior?: string | null }[]) {
  return createHash("sha256").update(JSON.stringify([...cases].sort((a, b) => a.id.localeCompare(b.id)).map(test => ({
    id: test.id, input: test.input, mustCall: [...test.mustCall].sort(), mustNotCall: [...test.mustNotCall].sort(),
    mustContain: [...test.mustContain].sort(), useGrader: test.useGrader, expectedBehavior: test.expectedBehavior ?? null,
  })))).digest("hex");
}
