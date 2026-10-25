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
    "w-full rounded-[6px] border border-border bg-surface px-2.5 py-2 text-[12px] text-text outline-none focus:border-muted";

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
      {/* Left working panel */}
      <div className="rounded-[6px] border border-border bg-panel p-4">
        {/* Draft with Gemini */}
        <section className="mb-4 rounded-[6px] border border-border bg-surface p-3">
          <div className="flex items-center justify-between">
            <span className="label-mono">Draft with Gemini</span>
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Describe what the agent should do; Gemini fills the form.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Answer customer returns questions from policy docs"
              className="flex-1 rounded-[6px] border border-border bg-panel px-2.5 py-2 text-[12px] text-text outline-none focus:border-muted"
            />
            <button
              onClick={runDraft}
              disabled={drafting || goal.trim().length === 0}
              className="rounded-[6px] bg-primary px-3 text-[12px] font-medium text-primary-text hover:brightness-95 disabled:opacity-40"
            >
              {drafting ? "Drafting…" : "Draft"}
            </button>
          </div>
          {draftError && <p className="mt-2 text-[11px] text-pending">{draftError}</p>}
        </section>

        {/* Templates */}
        <section className="mb-4">
          <span className="label-mono">Start from a template</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.key}
                onClick={() => applyTemplate(t)}
                className="rounded-[6px] border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted hover:text-text"
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b border-border text-[12px]">
          {(["form", "spec"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-2.5 py-1.5 ${
                tab === t
                  ? "border-text/70 text-text"
                  : "border-transparent text-muted hover:text-text"
              }`}
            >
              {t === "form" ? "Configure" : "Spec (YAML)"}
            </button>
          ))}
        </div>

        {tab === "form" ? (
          <div className="space-y-4">
            {assumptions.length > 0 && (
              <div className="rounded-[6px] border border-pending/30 bg-pending/10 p-3 text-[12px] text-pending">
                <span className="label-mono text-pending">Gemini assumptions</span>
                <ul className="mt-1 list-disc pl-4">
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
                className={`mt-1 ${inputClass}`}
                placeholder="Support Agent"
              />
            </div>

            <div>
              <label className="label-mono">Instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={6}
                className={`mt-1 ${inputClass} resize-y`}
                placeholder="Describe how the agent should behave…"
              />
            </div>

            <div>
              <label className="label-mono">Model</label>
              <div className="mt-1 inline-flex rounded-[6px] border border-border bg-surface px-2.5 py-2 font-mono text-[11px] text-muted">
                gemini-3.1-flash-lite
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="label-mono">Tools</label>
                <span className="font-mono text-[10px] text-muted">
                  🔒 = requires approval
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {catalog.map((tool) => {
                  const on = tools.has(tool.id);
                  return (
                    <label
                      key={tool.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-[6px] border bg-surface p-2.5 ${
                        on ? "border-muted" : "border-border hover:border-muted/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleTool(tool.id)}
                        className="mt-0.5 accent-[var(--success)]"
                      />
                      <span className="flex-1">
                        <span className="flex items-center gap-1.5 font-mono text-[12px] text-text">
                          {tool.id}
                          {tool.requiresApproval && (
                            <span
                              className="font-mono text-[10px] text-pending"
                              title="Requires approval"
                            >
                              🔒
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {tool.description}
                        </span>
                        {reasons[tool.id] && (
                          <span className="mt-0.5 block font-mono text-[11px] text-success">
                            {reasons[tool.id]}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {saveError && <p className="text-[12px] text-pending">{saveError}</p>}

            <button
              onClick={save}
              disabled={!canSave || saving}
              className="h-[34px] rounded-[6px] bg-primary px-4 text-[12px] font-medium text-primary-text hover:brightness-95 disabled:opacity-40"
            >
              {saving
                ? "Saving…"
                : mode === "create"
                  ? "Create agent"
                  : "Save new version"}
            </button>
          </div>
        ) : (
          <pre className="overflow-x-auto rounded-[6px] border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-text">
            {specYaml}
          </pre>
        )}
      </div>

      {/* Right rail: versions + publish (edit only) */}
      {mode === "edit" && detail && (
        <aside className="space-y-3">
          <div className="rounded-[6px] border border-border bg-panel p-3">
            <div className="flex items-center justify-between">
              <span className="label-mono">Versions</span>
              <span className="font-mono text-[10px] text-muted">
                current v{detail.version}
              </span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {detail.versions.map((v) => (
                <li
                  key={v.version}
                  className="flex items-center justify-between rounded-[6px] border border-border bg-surface px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-text">
                    v{v.version}
                    {v.isCurrent && (
                      <span className="rounded-[3px] bg-surface px-1 text-[10px] text-muted">
                        current
                      </span>
                    )}
                    {v.isPublished && (
                      <span className="rounded-[3px] bg-success/15 px-1 text-[10px] text-success">
                        published
                      </span>
                    )}
                  </span>
                  {!v.isCurrent && (
                    <button
                      onClick={() => onRollback(v.version)}
                      disabled={working}
                      className="text-[11px] text-muted hover:text-text disabled:opacity-40"
                    >
                      Roll back
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[6px] border border-border bg-panel p-3">
            <span className="label-mono">Publish</span>
            <p className="mt-1 text-[11px] text-muted">
              Marks the current version production-ready.
            </p>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-muted">
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
              className="mt-2 h-[32px] w-full rounded-[6px] border border-success/40 bg-success/10 text-[12px] font-medium text-success hover:bg-success/20 disabled:opacity-40"
            >
              {detail.published ? `Republish v${detail.version}` : "Publish"}
            </button>
            {detail.published && (
              <p className="mt-2 font-mono text-[11px] text-success">
                published v{detail.publishedVersion}
              </p>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
