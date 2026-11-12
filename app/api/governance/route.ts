import { z } from "zod";
import { currentOwner, configError } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { createOrganization, createTeam, updatePolicy, changeMember, savePack, governanceView } from "@/lib/governance/service";
import { GovernancePolicySchema, PackPayloadSchema } from "@/lib/governance/policy";
const id = z.string().uuid(), name = z.string().trim().min(1).max(80);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_organization"), name }).strict(),
  z.object({ action: z.literal("create_team"), organizationId: id, name }).strict(),
  z.object({ action: z.literal("update_policy"), scope: z.enum(["organization", "team"]), id, expectedRevision: z.number().int().positive(), policy: GovernancePolicySchema }).strict(),
  z.object({ action: z.literal("change_member"), organizationId: id, member: z.object({ email: z.email().max(254), role: z.enum(["member", "admin"]).optional(), teamId: id.optional(), remove: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal("save_pack"), organizationId: id, pack: z.object({ id: id.optional(), name, expectedVersion: z.number().int().positive().optional(), payload: PackPayloadSchema }).strict() }).strict(),
]);
export async function GET(request: Request) {
  try { return Response.json(await governanceView(await currentOwner(request)), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return configError(error); }
}
export async function POST(request: Request) {
  try {
    const owner = await currentOwner(request), input = await readBody(request, requestSchema);
    switch (input.action) {
      case "create_organization": await createOrganization(owner, input.name); break;
      case "create_team": await createTeam(owner, input.organizationId, input.name); break;
      case "update_policy": await updatePolicy(owner, input.scope, input.id, input.expectedRevision, input.policy); break;
      case "change_member": await changeMember(owner, input.organizationId, input.member); break;
      case "save_pack": await savePack(owner, input.organizationId, input.pack); break;
    }
    return Response.json({ saved: true });
  } catch (error) { return configError(error); }
}
