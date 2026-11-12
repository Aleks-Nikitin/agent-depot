import { currentOwner } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { saveGitHubBinding, SaveGitHubBindingSchema } from "@/lib/connectors/bindings";
import { connectorError } from "@/lib/connectors/http";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await saveGitHubBinding(await currentOwner(request), (await params).id, await readBody(request, SaveGitHubBindingSchema))); }
  catch (error) { return connectorError(error); }
}
