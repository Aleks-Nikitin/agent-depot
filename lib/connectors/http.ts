import { configError } from "@/lib/agents/library/http";
import { ConnectorError } from "./github-http";
export function connectorError(error: unknown) {
  if (error instanceof ConnectorError) return Response.json({ error: error.reason }, { status: 409 });
  return configError(error);
}
