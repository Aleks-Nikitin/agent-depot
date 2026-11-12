import { z } from "zod";
import { artifactHash } from "@/lib/agents/releases/fingerprint";
import { StateAssertionSchema, StateSnapshotSchema, type StateSnapshot, type StateAssertion } from "./schema";
import { checkState } from "./check";

export const StateEvidenceSchema = z.object({
  ownerId: z.string(), ownershipValid: z.boolean(), version: z.literal(1), manifestHash: z.string().nullable(), testCaseId: z.string(), runId: z.string().nullable(), sourceCompleted: z.boolean(),
  before: StateSnapshotSchema, after: StateSnapshotSchema, diff: z.unknown(),
  assertions: z.array(z.object({ assertion: StateAssertionSchema, passed: z.boolean(), reason: z.string().nullable() })).max(150),
  passed: z.boolean(), hash: z.string(),
}).strict();
export type StateEvidence = z.infer<typeof StateEvidenceSchema>;
export function stateEvidence(options: { ownerId: string; manifestHash: string | null; test: { id: string; mustCall: string[]; stateAssertions?: StateAssertion[] }; runId: string | null; sourceCompleted: boolean; before: StateSnapshot; after: StateSnapshot }): StateEvidence {
  const { test, ...snapshots } = options;
  const checked = checkState(test, options.before, options.after, options.ownerId);
  const payload = { version: 1 as const, ...snapshots, testCaseId: test.id, ...checked };
  return { ...payload, hash: artifactHash(payload) };
}
