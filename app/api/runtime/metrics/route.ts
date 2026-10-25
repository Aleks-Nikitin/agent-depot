import { z } from "zod";
import { authorize, HttpError, httpError } from "@/lib/agents/runtime/http";
import { MetricsWindowSchema, queryRuntimeMetrics } from "@/lib/agents/storage/metrics";
import { getDb } from "@/lib/db/prisma";

const QuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  agentId: z.string().min(1).max(100).optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const ownerId = await authorize(request);
    const params = new URL(request.url).searchParams;
    const entries = [...params.entries()];
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new HttpError(400, "invalid_metrics_window");
    const parsed = QuerySchema.safeParse(Object.fromEntries(entries));
    if (!parsed.success) throw new HttpError(400, "invalid_metrics_window");
    const window = MetricsWindowSchema.safeParse({ ...parsed.data, ownerId,
      from: new Date(parsed.data.from), to: new Date(parsed.data.to) });
    if (!window.success) throw new HttpError(400, "invalid_metrics_window");
    const report = await queryRuntimeMetrics(getDb(), window.data);
    return Response.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = httpError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
