import { ZodError } from "zod";
import { requestOwner } from "@/lib/auth/session";
import { HttpError } from "@/lib/auth/errors";

export const currentOwner = requestOwner;

const NOT_FOUND = new Set(["agent_not_found", "version_not_found"]);
const CONFLICT = new Set(["tests_not_passed"]);

export function configError(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) {
    return Response.json({ error: "invalid_input", issues: error.issues }, { status: 400 });
  }
  const reason = error instanceof Error ? error.message : "";
  if (NOT_FOUND.has(reason)) return Response.json({ error: reason }, { status: 404 });
  if (CONFLICT.has(reason)) return Response.json({ error: reason }, { status: 409 });
  return Response.json({ error: "server_error" }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ZodError([]);
  }
}
