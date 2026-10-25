import { getAuth } from "@/lib/auth";

async function handle(request: Request) {
  try {
    const response = await getAuth().handler(request);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return Response.json({ error: "auth_unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export const GET = handle;
export const POST = handle;
