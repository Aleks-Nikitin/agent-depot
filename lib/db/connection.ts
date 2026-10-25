/** One selector for Prisma CLI, runtime and metrics; never log these values. */
export function databaseUrl(env: Record<string, string | undefined> = process.env) {
  const target = env.DATABASE_TARGET ?? "local";
  if (target !== "local" && target !== "tiger") throw new Error("invalid_database_target");
  return target === "tiger" ? env.TIGER_DATABASE_URL : env.DATABASE_URL;
}
