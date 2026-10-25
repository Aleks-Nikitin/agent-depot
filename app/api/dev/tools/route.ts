import { z } from "zod";
import { integrationTools } from "@/lib/integrations";

const bodySchema = z
  .object({
    toolId: z.enum([
      "knowledge_search",
      "sales_lookup",
      "google_shopping",
      "google_news",
      "read_webpage",
      "send_email",
    ]),
    args: z.unknown().optional(),
  })
  .strict();

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  const tool = integrationTools[parsed.data.toolId];
  try {
    const result = await tool.run(parsed.data.args ?? {});
    return Response.json({ toolId: tool.id, result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "invalid_args", issues: error.issues }, { status: 400 });
    }
    return Response.json({ error: "tool_failed" }, { status: 500 });
  }
}
