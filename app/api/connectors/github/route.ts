import { currentOwner } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { GitHubConnectionInputSchema } from "@/lib/connectors/contracts";
import { connectGitHub, disconnectGitHub, connectionSummary } from "@/lib/connectors/github";
import { connectorEncryptionReady } from "@/lib/connectors/secrets";
import { connectorError } from "@/lib/connectors/http";
import { getDb } from "@/lib/db/prisma";
export async function GET(request: Request) {
  try {
    const owner = await currentOwner(request);
    return Response.json({ connection: await connectionSummary(owner), ready: connectorEncryptionReady(), operations: await getDb().connectorOperation.findMany({ where: { ownerId: owner }, orderBy: { createdAt: "desc" }, take: 10,
      select: { key: true, runId: true, repository: true, status: true, result: true, reason: true } }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return connectorError(error); }
}
export async function PUT(request: Request) {
  try {
    const owner = await currentOwner(request);
    return Response.json({ connection: await connectGitHub(owner, await readBody(request, GitHubConnectionInputSchema), request.signal) });
  } catch (error) { return connectorError(error); }
}
export async function DELETE(request: Request) {
  try { await disconnectGitHub(await currentOwner(request)); return Response.json({ disconnected: true }); }
  catch (error) { return connectorError(error); }
}
