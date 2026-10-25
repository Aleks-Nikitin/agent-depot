import type { AgentDetail, AgentSummary } from "@/lib/agents/library/store";
import type { AgentInput } from "@/lib/agents/library/schema";

export type { AgentDetail, AgentSummary };

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request_failed_${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const res = await fetch("/api/agents", { cache: "no-store" });
  const body = await parse<{ agents: AgentSummary[] }>(res);
  return body.agents;
}

export function createAgent(input: AgentInput): Promise<AgentDetail> {
  return fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => parse<AgentDetail>(res));
}

export function updateAgent(id: string, input: AgentInput): Promise<AgentDetail> {
  return fetch(`/api/agents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => parse<AgentDetail>(res));
}

export function duplicateAgent(id: string): Promise<AgentDetail> {
  return fetch(`/api/agents/${id}/duplicate`, { method: "POST" }).then((res) =>
    parse<AgentDetail>(res),
  );
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete_failed_${res.status}`);
}

export function rollbackAgent(id: string, version: number): Promise<AgentDetail> {
  return fetch(`/api/agents/${id}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  }).then((res) => parse<AgentDetail>(res));
}

export function publishAgent(id: string, testsPassed: boolean): Promise<AgentDetail> {
  return fetch(`/api/agents/${id}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ testsPassed }),
  }).then((res) => parse<AgentDetail>(res));
}
