// Direct tool invocation bypasses runtime permissions/approval. Use agent execution instead.
export async function POST() {
  return Response.json({ error: "use_agent_runtime" }, { status: 410 });
}
