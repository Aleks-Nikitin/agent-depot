import { readJson } from "@/lib/agents/library/http";
import { createTestCase, listTestCases, testCaseError } from "@/lib/evals/test-cases";

type Context = { params: Promise<{ id: string }> };

/** GET /api/agents/[id]/tests — the agent's saved test cases. */
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json({ testCases: await listTestCases(id) });
  } catch (error) {
    return testCaseError(error);
  }
}

/** POST /api/agents/[id]/tests — save a new test case. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const testCase = await createTestCase(id, await readJson(request));
    return Response.json(testCase, { status: 201 });
  } catch (error) {
    return testCaseError(error);
  }
}
