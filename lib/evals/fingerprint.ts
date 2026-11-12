import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { EvaluationSeedSchema } from "./isolation/fixtures";
import { StateAssertionsSchema } from "./state/schema";

export function testFingerprint(cases: { id: string; input: string; mustCall: string[]; mustNotCall: string[];
  fixtures?: unknown; stateAssertions?: unknown; mustContain: string[]; useGrader: boolean; expectedBehavior?: string | null }[]) {
  return artifactHash([...cases].sort((a, b) => a.id.localeCompare(b.id)).map(test => ({
    fixtures: EvaluationSeedSchema.parse(test.fixtures ?? {}), stateAssertions: StateAssertionsSchema.parse(test.stateAssertions ?? []),
    id: test.id, input: test.input, mustCall: [...test.mustCall].sort(), mustNotCall: [...test.mustNotCall].sort(),
    mustContain: [...test.mustContain].sort(), useGrader: test.useGrader, expectedBehavior: test.expectedBehavior ?? null,
  })));
}
