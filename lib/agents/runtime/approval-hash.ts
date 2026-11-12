import { createHash } from "node:crypto";
import type { PendingCall } from "./state";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function approvalHash(ownerId: string, runId: string, call: PendingCall) {
  const normalized = JSON.parse(JSON.stringify({ ownerId, runId, ...call }));
  return createHash("sha256").update(canonical(normalized)).digest("hex");
}
