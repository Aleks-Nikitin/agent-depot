import { currentOwner } from "@/lib/agents/library/http";
import { readJson } from "@/lib/agents/library/http";
import { deleteTestCase, testCaseError, updateTestCase } from "@/lib/evals/test-cases";

type Context = { params: Promise<{ id: string }> };

/** PATCH /api/tests/[id] — update a saved test case (omitted fields are kept). */
export async function PATCH(request: Request, context: Context) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    return Response.json(await updateTestCase(ownerId, id, await readJson(request)));
  } catch (error) {
    return testCaseError(error);
  }
}

/** DELETE /api/tests/[id] */
export async function DELETE(request: Request, context: Context) {
  try {
    const ownerId = await currentOwner(request);
    const { id } = await context.params;
    await deleteTestCase(ownerId, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return testCaseError(error);
  }
}
