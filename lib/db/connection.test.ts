import { expect, it } from "vitest";
import { databaseUrl, databaseConnectionSummary } from "./connection";

it("selects local by default and Tiger only explicitly, without falling back on missing credentials", () => {
  const env = { DATABASE_URL: "local-test-url", TIGER_DATABASE_URL: "tiger-test-url" };
  expect(databaseUrl(env)).toBe("local-test-url");
  expect(databaseUrl({ ...env, DATABASE_TARGET: "tiger" })).toBe("tiger-test-url");
  expect(databaseUrl({ DATABASE_TARGET: "tiger", DATABASE_URL: "local-test-url" })).toBeUndefined();
  expect(() => databaseUrl({ ...env, DATABASE_TARGET: "invalid" })).toThrow("invalid_database_target");
});

it("reports the exact selected source and missing password without leaking connection values", () => {
  const url = "postgresql://private-user@private-host.example:33833/private-database?sslmode=require";
  const summary = databaseConnectionSummary({ DATABASE_TARGET: "tiger", DATABASE_URL: "postgresql://local:local-password@localhost/local", TIGER_DATABASE_URL: url });
  expect(summary).toMatchObject({ target: "tiger", sourceVariable: "TIGER_DATABASE_URL", usernamePresent: true,
    passwordPresent: false, localEndpoint: false, databasePresent: true, explicitPort: true, sslmode: "require", libpqCompatibility: false });
  for (const value of [url, "private-user", "private-host", "private-database", "local-password"]) {
    expect(JSON.stringify(summary)).not.toContain(value);
  }
});

it("recognizes encoded credentials and compatibility settings while keeping local selection independent", () => {
  const env = { TIGER_DATABASE_URL: "postgresql://private:encoded%40password%3Avalue@host.example/db?sslmode=require&uselibpqcompat=true",
    DATABASE_URL: "postgresql://local@127.0.0.1:55433/local", NODE_TLS_REJECT_UNAUTHORIZED: "0" };
  expect(databaseConnectionSummary({ ...env, DATABASE_TARGET: "tiger" })).toMatchObject({ passwordPresent: true, libpqCompatibility: true, globalTlsVerificationDisabled: true });
  expect(databaseConnectionSummary(env)).toMatchObject({ sourceVariable: "DATABASE_URL", localEndpoint: true, passwordPresent: false });
});

it("rejects malformed schemes and avoids printing arbitrary SSL parameter values", () => {
  expect(() => databaseConnectionSummary({ DATABASE_URL: "https://host.example" })).toThrow("invalid_database_url");
  expect(() => databaseConnectionSummary({ DATABASE_TARGET: "tiger", DATABASE_URL: "postgresql://local/db" })).toThrow("missing_database_url");
  expect(databaseConnectionSummary({ DATABASE_URL: "postgresql://local/db?sslmode=secret-placeholder" }).sslmode).toBe("unrecognized");
});
