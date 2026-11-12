"use client";
import { useState } from "react";
import Link from "next/link";
import type { agentGitHubView } from "@/lib/connectors/bindings";
export function AgentGitHubPanel({ initial }: { initial: Awaited<ReturnType<typeof agentGitHubView>> }) {
  const [read, setRead] = useState(initial.read), [write, setWrite] = useState(initial.write);
  const [version, setVersion] = useState(initial.version), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(initial.agentId)}/github`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: version, read, write }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "save_failed");
      setVersion(result.version); setMessage(`Saved draft v${result.version}. Review and test it before publishing.`);
    } catch { setMessage("Could not save. Check the connection and reload if the agent has changed."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5 p-6"><h1 className="text-2xl font-semibold">Agent connections</h1>
    <p className="text-(--ad-muted)">Choose what this agent may do in your connected repository. Repository access is pinned to a connection revision; reconnecting requires saving a new draft here.</p>
    <p>Repository: {initial.connection?.enabled ? initial.connection.repository : "Not connected"}. <Link href="/tools" className="underline">Manage GitHub access</Link></p>
    {!initial.bindingCurrent && (initial.read || initial.write) && <p role="status">This agent’s connection has changed. Save to bind the current connection.</p>}
    <label className="flex gap-3"><input type="checkbox" checked={read} onChange={e => setRead(e.target.checked)} />Read issues</label>
    <label className="flex gap-3"><input type="checkbox" checked={write} disabled={!initial.connection?.allowWrites} onChange={e => setWrite(e.target.checked)} />Propose issue creation · human approval always required</label>
    <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-(--ad-ice) px-4 py-2 text-(--ad-bg)">{busy ? "Saving…" : "Save connection permissions"}</button>
    <p role="status">{message}</p>
  </section>;
}
