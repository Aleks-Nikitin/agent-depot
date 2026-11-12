import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { databaseUrl } from "../../db/connection";

let saver: PostgresSaver | undefined;
export function graphCheckpointer() {
  if (!saver) {
    const url = databaseUrl();
    if (!url) throw new Error("missing_database_url");
    saver = PostgresSaver.fromConnString(url, { schema: "langgraph_checkpoints" });
  }
  // Schema setup belongs to the explicit deployment command, never a model run.
  return Promise.resolve(saver);
}
