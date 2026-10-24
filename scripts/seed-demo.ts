import "dotenv/config";
import { getDb } from "../lib/db/prisma";
import { supportAgent, salesAgent } from "../lib/agents/fixtures";

async function main() {
  const db = getDb();
  try {
    for (const config of [supportAgent, salesAgent]) {
      await db.agent.upsert({ where: { id: config.id }, update: {}, create: {
        id: config.id, ownerId: config.ownerId, name: config.name, version: config.version, config,
      } });
    }
    console.log("Demo agents available: support-demo, sales-demo. Existing records were preserved.");
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
