export class PolicyBlock extends Error {}
export class ExecutionFailure extends Error {}
export function guard(condition: boolean, reason: string): asserts condition {
  if (!condition) throw new PolicyBlock(reason);
}
