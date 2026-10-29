import "dotenv/config";
import { graphCheckpointer } from "../lib/agents/runtime/checkpointer";

async function main() {
  const saver = await graphCheckpointer();
  try {
    await saver.setup();
    console.log("Graph checkpoint schema ready.");
  } finally {
    await saver.end();
  }
}
void main().catch(() => {
  console.error("Graph checkpoint schema setup failed.");
  process.exitCode = 1;
});
