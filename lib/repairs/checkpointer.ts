import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { databaseUrl } from "@/lib/db/connection";
let saver: PostgresSaver | undefined;
export function repairCheckpointer() {
  const url = databaseUrl(); if (!url) throw new Error("missing_database_url");
  return saver ??= PostgresSaver.fromConnString(url, { schema: "langgraph_repairs" });
}
export const repairThread = (id: string) => `repair:v1:${id}`;
