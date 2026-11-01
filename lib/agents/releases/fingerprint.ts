import { createHash } from "node:crypto";

export function artifactHash(value: unknown): string {
  const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`
    : JSON.stringify(v) ?? "null";
  return createHash("sha256").update(canonical(value)).digest("hex");
}
