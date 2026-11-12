import { randomBytes, createHash } from "node:crypto";
import { getDb } from "@/lib/db/prisma";
import { HttpError } from "@/lib/auth/errors";
import { lockedPolicy } from "@/lib/workspaces/policy";
import { MCP_CATALOG_HASH, McpKeyInputSchema, McpScopeSchema } from "./catalog";

export function mcpAudience() {
  const value = process.env.BETTER_AUTH_URL; if (!value) throw new HttpError(503, "mcp_origin_unavailable");
  const url = new URL(value);
  if ((url.protocol === "http:" && (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) || !["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new HttpError(503, "mcp_origin_unavailable");
  return new URL("/api/mcp", url.origin).href;
}
const digest = (secret: string) => createHash("sha256").update(secret).digest("hex");
export async function createMcpKey(ownerId: string, raw: unknown) {
  const input = McpKeyInputSchema.parse(raw), audience = mcpAudience();
  const user = await getDb().user.findUnique({ where: { id: ownerId }, select: { isAnonymous: true } });
  if (!user || user.isAnonymous) throw new HttpError(403, "registered_account_required");
  const secret = "ad_mcp_" + randomBytes(32).toString("base64url");
  return getDb().$transaction(async tx => {
    await lockedPolicy(tx, ownerId);
    const agentIds = [...new Set(input.agentIds)], tools = [...new Set(input.tools)];
    if (await tx.agent.count({ where: { ownerId, id: { in: agentIds } } }) !== agentIds.length) throw new HttpError(404, "agent_not_found");
    if (await tx.mcpAccessKey.count({ where: { ownerId, revokedAt: null, expiresAt: { gt: new Date() } } }) >= 10) throw new HttpError(409, "mcp_key_limit");
    const key = await tx.mcpAccessKey.create({ data: { ownerId, name: input.name, secretHash: digest(secret), scope: { agentIds, tools }, catalogHash: MCP_CATALOG_HASH, audience,
      expiresAt: new Date(Date.now() + input.expiresDays * 86_400_000) }, select: { id: true, name: true, scope: true, expiresAt: true } });
    return { ...key, secret, endpoint: audience };
  });
}
export async function listMcpKeys(ownerId: string) {
  return getDb().mcpAccessKey.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, scope: true, expiresAt: true, revokedAt: true } });
}
export async function revokeMcpKey(ownerId: string, id: string) {
  const updated = await getDb().mcpAccessKey.updateMany({ where: { id, ownerId }, data: { revokedAt: new Date() } });
  if (!updated.count) throw new HttpError(404, "mcp_key_not_found");
}
export async function authorizeMcp(request: Request) {
  const audience = mcpAudience(), origin = request.headers.get("origin"), canonical = new URL(audience);
  if (origin && origin !== canonical.origin || new URL(request.url).host !== canonical.host) throw new HttpError(403, "mcp_origin_denied");
  const secret = request.headers.get("authorization")?.match(/^Bearer (ad_mcp_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!secret) throw new HttpError(401, "mcp_key_required");
  return getDb().$transaction(async tx => {
    const hash = digest(secret);
    await tx.$queryRaw`SELECT "id" FROM "McpAccessKey" WHERE "secretHash"=${hash} FOR UPDATE`;
    const key = await tx.mcpAccessKey.findUnique({ where: { secretHash: hash } });
    if (!key || key.revokedAt || key.expiresAt.getTime() <= Date.now()) throw new HttpError(401, "mcp_key_unavailable");
    if (key.catalogHash !== MCP_CATALOG_HASH || key.audience !== audience) throw new HttpError(401, "mcp_key_revision_changed");
    if (!await tx.user.findUnique({ where: { id: key.ownerId } })) throw new HttpError(401, "mcp_key_unavailable");
    const reset = Date.now() - key.windowStartedAt.getTime() >= 60_000;
    if (!reset && key.requestCount >= 60) throw new HttpError(429, "mcp_rate_limited");
    await tx.mcpAccessKey.update({ where: { id: key.id }, data: { windowStartedAt: reset ? new Date() : key.windowStartedAt, requestCount: reset ? 1 : { increment: 1 } } });
    return { id: key.id, ownerId: key.ownerId, scope: McpScopeSchema.parse(key.scope) };
  });
}
