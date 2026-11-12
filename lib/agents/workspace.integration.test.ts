import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { getDb } from "../db/prisma";
import { ensureWorkspace } from "./workspace";

const db = getDb();
const ownerId = `workspace-test-${randomUUID()}`;
afterAll(async () => { await db.workspace.deleteMany({ where: { ownerId } }); await db.$disconnect(); });
it("backfills existing owners and creates one container under concurrent first access", async () => {
  const owners = await db.$queryRaw<{ missing: bigint }[]>`
    SELECT count(*) AS missing FROM (
      SELECT "id" AS owner FROM "user" UNION SELECT "ownerId" FROM "Agent"
    ) o LEFT JOIN "Workspace" w ON w."ownerId" = o.owner WHERE w.id IS NULL`;
  expect(Number(owners[0].missing)).toBe(0);
  const [a, b] = await Promise.all([ensureWorkspace(db, ownerId), ensureWorkspace(db, ownerId)]);
  expect(a.id).toBe(b.id);
  expect(a.ownerId).toBe(ownerId);
  expect(await db.workspace.count({ where: { ownerId } })).toBe(1);
});
