import { z } from "zod";
import { addKnowledgeDoc, getKnowledgeDocs } from "@/lib/integrations/store";

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(8000),
  })
  .strict();

export async function GET() {
  return Response.json({ docs: getKnowledgeDocs() });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  const doc = addKnowledgeDoc(parsed.data);
  return Response.json({ doc }, { status: 201 });
}
