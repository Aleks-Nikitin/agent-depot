import "dotenv/config";
import { defineConfig } from "prisma/config";
import { databaseUrl } from "./lib/db/connection";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl() },
});
