import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "../auth";
import { HttpError } from "./errors";

export async function sessionOwner(requestHeaders: Headers) {
  if (!requestHeaders.get("cookie")) throw new HttpError(401, "unauthorized");
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) throw new HttpError(401, "unauthorized");
  return session.user.id;
}

export function verifyMutationOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const expected = process.env.BETTER_AUTH_URL;
  const origin = request.headers.get("origin");
  if (!expected || !origin || origin !== new URL(expected).origin
    || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "invalid_origin");
}

export async function requestOwner(request: Request) {
  if (!request.headers.get("cookie")) throw new HttpError(401, "unauthorized");
  verifyMutationOrigin(request);
  return sessionOwner(request.headers);
}

export async function pageOwnerOrNull() {
  const requestHeaders = await headers();
  if (!requestHeaders.get("cookie")) return null;
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return session?.user.id ?? null;
}

export async function pageOwner() {
  const ownerId = await pageOwnerOrNull();
  if (!ownerId) redirect("/auth");
  return ownerId;
}
