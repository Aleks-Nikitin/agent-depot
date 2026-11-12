import { z } from "zod";
import { currentOwner } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { reconcileGitHubIssue } from "@/lib/connectors/github";
import { connectorError } from "@/lib/connectors/http";
export async function POST(request: Request) {
  try {
    const owner = await currentOwner(request);
    const input = await readBody(request, z.object({ key: z.string().min(1).max(500) }).strict());
    return Response.json(await reconcileGitHubIssue(owner, input.key, request.signal));
  } catch (error) { return connectorError(error); }
}
