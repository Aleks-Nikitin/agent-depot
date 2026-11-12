import { z } from "zod";
import { currentOwner, configError } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { createMcpKey, listMcpKeys, revokeMcpKey, mcpAudience } from "@/lib/mcp/keys";
import { McpKeyInputSchema } from "@/lib/mcp/catalog";
export async function GET(request: Request) {
 try { const ownerId = await currentOwner(request); return Response.json({ keys: await listMcpKeys(ownerId), endpoint: mcpAudience() }, { headers: { "Cache-Control": "private, no-store" } }); }
 catch (error) { return configError(error); }
}
export async function POST(request: Request) {
 try { const ownerId = await currentOwner(request); return Response.json(await createMcpKey(ownerId, await readBody(request, McpKeyInputSchema)), { status: 201, headers: { "Cache-Control": "private, no-store" } }); }
 catch (error) { return configError(error); }
}
export async function DELETE(request: Request) {
 try { const ownerId = await currentOwner(request); const input = await readBody(request, z.object({ id: z.string().uuid() }).strict()); await revokeMcpKey(ownerId, input.id); return Response.json({ revoked: true }); }
 catch (error) { return configError(error); }
}
