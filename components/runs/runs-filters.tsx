"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SearchIcon, XIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { statusStyle } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import type { RunStatus } from "@/lib/runs/format";

export type RunFilters = { query: string; agentId: string; status: RunStatus | "" };
export const emptyFilters: RunFilters = { query: "", agentId: "", status: "" };

const statuses = Object.keys(statusStyle) as RunStatus[];

export function RunsFilters({ value, onChange, agents, onExport }: {
  value: RunFilters; onChange: (f: RunFilters) => void; agents: Array<{ id: string; name: string }>; onExport: () => void;
}) {
  const dirty = value.query || value.agentId || value.status;
  return (
    <Card className="flex flex-wrap items-center gap-3 p-3">
      <div className="relative min-w-[220px] flex-[2]">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-(--ad-muted)" />
        <label htmlFor="runs-search" className="sr-only">Filter runs</label>
        <Input id="runs-search" value={value.query} onChange={e => onChange({ ...value, query: e.target.value })}
          placeholder="Filter by run, input text, or agent…" className="pl-9" />
      </div>
      <Select aria-label="Agent" prefix="Agent:" className="min-w-[200px] flex-1" value={value.agentId}
        onChange={e => onChange({ ...value, agentId: e.target.value })}>
        <option value="">All agents</option>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </Select>
      <Select aria-label="Status" prefix="Status:" className="min-w-[180px] flex-1" value={value.status}
        onChange={e => onChange({ ...value, status: e.target.value as RunFilters["status"] })}>
        <option value="">Any status</option>
        {statuses.map(s => <option key={s} value={s}>{statusStyle[s].label}</option>)}
      </Select>
      <div className="flex gap-2">
        {dirty && <Button variant="ghost" onClick={() => onChange(emptyFilters)}><XIcon /> Clear</Button>}
        <Button className="ad-mono" onClick={onExport}>Export CSV</Button>
      </div>
    </Card>
  );
}
