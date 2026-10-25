/** One selector for Prisma CLI, runtime and metrics; never log these values. */
export function databaseUrl(env: Record<string, string | undefined> = process.env) {
  const target = env.DATABASE_TARGET ?? "local";
  if (target !== "local" && target !== "tiger") throw new Error("invalid_database_target");
  return target === "tiger" ? env.TIGER_DATABASE_URL : env.DATABASE_URL;
}

/** Safe diagnostic metadata only: no endpoint, database, username or secret values. */
export function databaseConnectionSummary(env: Record<string, string | undefined> = process.env) {
  const value = databaseUrl(env);
  if (!value) throw new Error("missing_database_url");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("invalid_database_url");
  const target = env.DATABASE_TARGET ?? "local";
  const mode = url.searchParams.get("sslmode");
  const supportedModes = ["disable", "allow", "prefer", "require", "verify-ca", "verify-full", "no-verify"];
  return {
    target,
    sourceVariable: target === "tiger" ? "TIGER_DATABASE_URL" : "DATABASE_URL",
    usernamePresent: !!url.username,
    passwordPresent: !!url.password,
    databasePresent: url.pathname.length > 1,
    explicitPort: !!url.port,
    localEndpoint: ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    sslmode: mode === null ? "unspecified" : supportedModes.includes(mode) ? mode : "unrecognized",
    libpqCompatibility: url.searchParams.get("uselibpqcompat") === "true",
    globalTlsVerificationDisabled: env.NODE_TLS_REJECT_UNAUTHORIZED === "0",
  };
}
