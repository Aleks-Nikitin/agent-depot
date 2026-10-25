import { expect, it } from "vitest";
import { databaseUrl } from "./connection";

it("selects local by default and Tiger only explicitly, without falling back on missing credentials", () => {
  const env = { DATABASE_URL: "local-test-url", TIGER_DATABASE_URL: "tiger-test-url" };
  expect(databaseUrl(env)).toBe("local-test-url");
  expect(databaseUrl({ ...env, DATABASE_TARGET: "tiger" })).toBe("tiger-test-url");
  expect(databaseUrl({ DATABASE_TARGET: "tiger", DATABASE_URL: "local-test-url" })).toBeUndefined();
  expect(() => databaseUrl({ ...env, DATABASE_TARGET: "invalid" })).toThrow("invalid_database_target");
});
