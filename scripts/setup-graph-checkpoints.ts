import "dotenv/config";
import { repairCheckpointer } from "../lib/repairs/checkpointer";
import { graphCheckpointer } from "../lib/agents/runtime/checkpointer";

async function main() {
  const saver = await graphCheckpointer();
  try {
    await saver.setup();
    await repairCheckpointer().setup();
    console.log("Graph checkpoint schema ready.");
  } finally {
    await saver.end();
    await repairCheckpointer().end();
  }
}
void main().catch(() => {
  console.error("Graph checkpoint schema setup failed.");
  process.exitCode = 1;
});
