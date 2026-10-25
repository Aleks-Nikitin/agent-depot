"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ToolCatalogEntry, AgentTemplate } from "@/lib/agents/library/catalog";
import type { AgentDetail } from "@/lib/agents/library/store";
import { toYaml } from "@/lib/agents/library/yaml";
import { draftAgentAction } from "../actions";
import {
  createAgent,
  updateAgent,
  rollbackAgent,
  publishAgent,
} from "./api";

type Props = {
  mode: "create" | "edit";
  catalog: ToolCatalogEntry[];
  templates: AgentTemplate[];
  initial?: AgentDetail;
};

type Tab = "form" | "spec";

export default function AgentBuilder({ mode, catalog, templates, initial }: Props) {
  const router = useRouter();

  const [name, setName] = useState(initial?.name ?? "");
  const [instructions, setInstructions] = useState(initial?.config.instructions ?? "");
  const [tools, setTools] = useState<Set<string>>(
    new Set(initial?.config.enabledTools ?? []),
  );
  const [tab, setTab] = useState<Tab>("form");

  // "Draft with Gemini"
  const [goal, setGoal] = useState("");
  const [drafting, startDraft] = useTransition();
  const [draftError, setDraftError] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  // Save / versions / publish
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentDetail | undefined>(initial);
  const [testsPassed, setTestsPassed] = useState(false);
  const [working, setWorking] = useState(false);

  const toggleTool = (id: string) => {
    setTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyTemplate = (template: AgentTemplate) => {
    setName(template.name);
    setInstructions(template.instructions);
    setTools(new Set(template.enabledTools));
    setAssumptions([]);
    setReasons({});
  };

  const runDraft = () => {
    setDraftError(null);
    startDraft(async () => {
      const result = await draftAgentAction(goal);
      if (!result.ok) {
        setDraftError(result.error);
        return;
      }
      const draft = result.draft;
      setName(draft.name);
      setInstructions(draft.instructions);
      setTools(new Set(draft.tools.map((t) => t.id)));
      setAssumptions(draft.assumptions);
      setReasons(Object.fromEntries(draft.tools.map((t) => [t.id, t.reason])));
    });
  };

  const input = useMemo(
    () => ({
      name: name.trim(),
      instructions: instructions.trim(),
      model: "gemini" as const,
      enabledTools: [...tools],
    }),
    [name, instructions, tools],
  );

  const specYaml = useMemo(
    () =>
      toYaml({
        name: input.name || "(unnamed)",
        model: input.model,
        instructions: input.instructions || "(empty)",
        enabledTools: input.enabledTools,
        requireWriteApproval: true,
      }),
    [input],
  );

  const canSave = input.name.length > 0 && input.instructions.length > 0;

  const save = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      if (mode === "create") {
        const created = await createAgent(input);
        router.push(`/agents/${created.id}`);
      } else if (detail) {
        const updated = await updateAgent(detail.id, input);
        setDetail(updated);
        router.refresh();
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const onRollback = async (version: number) => {
    if (!detail) return;
    setWorking(true);
    try {
      const updated = await rollbackAgent(detail.id, version);
      setDetail(updated);
      setName(updated.name);
      setInstructions(updated.config.instructions);
      setTools(new Set(updated.config.enabledTools));
      router.refresh();
    } finally {
      setWorking(false);
    }
  };

  const onPublish = async () => {
    if (!detail) return;
    setWorking(true);
    try {
      const updated = await publishAgent(detail.id, testsPassed);
      setDetail(updated);
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Publish failed.");
    } finally {
      setWorking(false);
    }
  };

  const inputClass =
    "w-full rounded-[10px] border border-line bg-paper px-3.5 py-2.5 text-[14px] text-ink outline-none focus:border-muted";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      {/* Left working panel */}
      <div className="rounded-[10px] border border-line bg-panel p-6">
        {/* Draft with Gemini */}
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="label-mono">{"// Draft with Gemini"}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
          </div>
          <div className="flex items-stretch overflow-hidden rounded-full border border-line bg-paper">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="describe what the agent should do…"
              className="flex-1 bg-transparent px-4 text-[14px] text-ink outline-none"
            />
            <button
              onClick={runDraft}
              disabled={drafting || goal.trim().length === 0}
              className="mono m-1 rounded-full bg-ink px-5 py-2.5 text-[11px] tracking-[0.12em] text-paper hover:bg-ink/90 disabled:opacity-40"
            >
              {drafting ? "DRAFTING…" : "[ DRAFT → ]"}
            </button>
          </div>
          {draftError && <p className="mt-2 text-[13px] italic text-accent">{draftError}</p>}
        </section>

        {/* Templates */}
        <section className="mb-6">
          <span className="label-mono">{"// Start from a template"}</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.key}
                onClick={() => applyTemplate(t)}
                className="mono rounded-full border border-line bg-paper px-4 py-1.5 text-[12px] text-muted hover:text-ink"
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* Tabs */}
        <div className="mb-5 flex gap-5 border-b border-line">
          {(["form", "spec"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`label-mono -mb-px border-b-2 pb-2.5 ${
                tab === t ? "border-accent !text-ink" : "border-transparent hover:!text-ink"
              }`}
            >
              {t === "form" ? "Configure" : "Spec · YAML"}
            </button>
          ))}
        </div>

        {tab === "form" ? (
          <div className="space-y-5">
            {assumptions.length > 0 && (
              <div className="rounded-[10px] border border-accent/40 bg-accent/10 p-4">
                <span className="label-mono !text-accent">Gemini assumptions</span>
                <ul className="mt-1.5 list-disc pl-5 text-[14px] text-ink">
                  {assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <label className="label-mono">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`mt-1.5 ${inputClass}`}
                placeholder="Support Agent"
              />
            </div>

            <div>
              <label className="label-mono">Instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={6}
                className={`mt-1.5 ${inputClass} resize-y`}
                placeholder="Describe how the agent should behave…"
              />
            </div>

            <div>
              <label className="label-mono">Model</label>
              <div className="mono mt-1.5 inline-flex rounded-full border border-line bg-paper px-4 py-2 text-[12px] text-muted">
                gemini-3.1-flash-lite
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="label-mono">Tools</label>
                <span className="mono text-[11px] text-muted">🔒 = requires approval</span>
              </div>
              <div className="mt-2 space-y-2">
                {catalog.map((tool) => {
                  const on = tools.has(tool.id);
                  return (
                    <label
                      key={tool.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-[10px] border bg-paper p-3.5 ${
                        on ? "border-accent/50" : "border-line hover:border-muted/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleTool(tool.id)}
                        className="mt-1 accent-[var(--accent)]"
                      />
                      <span className="flex-1">
                        <span className="mono flex items-center gap-1.5 text-[13px] text-ink">
                          {tool.id}
                          {tool.requiresApproval && (
                            <span className="text-[11px] text-accent" title="Requires approval">
                              🔒
                            </span>
                          )}
                        </span>
                        <span className="block text-[13px] italic text-muted">
                          {tool.description}
                        </span>
                        {reasons[tool.id] && (
                          <span className="mono mt-0.5 block text-[12px] text-success">
                            {reasons[tool.id]}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {saveError && <p className="text-[13px] italic text-accent">{saveError}</p>}

            <button
              onClick={save}
              disabled={!canSave || saving}
              className="mono rounded-full bg-ink px-6 py-3 text-[12px] tracking-[0.12em] text-paper hover:bg-ink/90 disabled:opacity-40"
            >
              {saving
                ? "SAVING…"
                : mode === "create"
                  ? "[ CREATE AGENT → ]"
                  : "[ SAVE NEW VERSION → ]"}
            </button>
          </div>
        ) : (
          <pre className="overflow-x-auto rounded-[10px] border border-line bg-paper p-4 font-mono text-[12px] leading-relaxed text-ink">
            {specYaml}
          </pre>
        )}
      </div>

      {/* Right rail: versions + publish (edit only) */}
      {mode === "edit" && detail && (
        <aside className="space-y-4">
          <div className="rounded-[10px] border border-line bg-panel p-4">
            <div className="flex items-center justify-between">
              <span className="label-mono">Versions</span>
              <span className="mono text-[11px] text-muted">current v{detail.version}</span>
            </div>
            <ul className="mt-3 space-y-2">
              {detail.versions.map((v) => (
                <li
                  key={v.version}
                  className="flex items-center justify-between rounded-[10px] border border-line bg-paper px-3.5 py-2"
                >
                  <span className="mono flex items-center gap-1.5 text-[12px] text-ink">
                    v{v.version}
                    {v.isCurrent && (
                      <span className="rounded-[4px] bg-raised px-1.5 text-[10px] text-muted">
                        current
                      </span>
                    )}
                    {v.isPublished && (
                      <span className="rounded-[4px] bg-success/15 px-1.5 text-[10px] text-success">
                        published
                      </span>
                    )}
                  </span>
                  {!v.isCurrent && (
                    <button
                      onClick={() => onRollback(v.version)}
                      disabled={working}
                      className="mono text-[11px] text-muted hover:text-ink disabled:opacity-40"
                    >
                      roll back
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[10px] border border-line bg-panel p-4">
            <span className="label-mono">Publish</span>
            <p className="mt-1.5 text-[13px] italic text-muted">
              Marks the current version production-ready.
            </p>
            <label className="mt-3 flex items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={testsPassed}
                onChange={(e) => setTestsPassed(e.target.checked)}
                className="accent-[var(--success)]"
              />
              Tests passed (wired to Dev 3&apos;s suite)
            </label>
            <button
              onClick={onPublish}
              disabled={!testsPassed || working}
              className="mono mt-3 w-full rounded-full border border-success/50 bg-success/10 py-2.5 text-[12px] tracking-[0.1em] text-success hover:bg-success/20 disabled:opacity-40"
            >
              {detail.published ? `REPUBLISH v${detail.version}` : "PUBLISH"}
            </button>
            {detail.published && (
              <p className="mono mt-2 text-[12px] text-success">
                published v{detail.publishedVersion}
              </p>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
