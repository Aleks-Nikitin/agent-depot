import { currentOwner, configError } from "@/lib/agents/library/http";
import { readBody } from "@/lib/agents/runtime/http";
import { AssignmentSchema, SaveAssignmentSchema, previewAssignment, saveAssignment } from "@/lib/governance/service";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await previewAssignment(await currentOwner(request), (await params).id, await readBody(request, AssignmentSchema))); }
  catch (error) { return configError(error); }
}
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await saveAssignment(await currentOwner(request), (await params).id, await readBody(request, SaveAssignmentSchema))); }
  catch (error) { return configError(error); }
}
