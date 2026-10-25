"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { TestCaseInputSchema, type TestCaseInput } from "@/lib/evals/schema";
import { useRouter } from "next/navigation";
import type { ToolCatalogEntry, AgentTemplate } from "@/lib/agents/library/catalog";
import type { AgentDetail } from "@/lib/agents/library/store";
import { toYaml } from "@/lib/agents/library/yaml";
import { draftAgentAction } from "../actions";
import {
  createAgent,
  updateAgent,
  rollbackAgent,
  evaluateSavedAgent,
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
  const [suggestedTests, setSuggestedTests] = useState<TestCaseInput[]>([]);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [maxCalls, setMaxCalls] = useState(initial?.config.limits.maxModelCalls ?? 5);
  const [costCap, setCostCap] = useState(initial?.config.limits.maxEstimatedCostUsd ?? 0.05);
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
    setSuggestedTests(template.testCases ?? []);
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
      setSuggestedTests(draft.suggestedTests.map(test => TestCaseInputSchema.parse({ ...test, useGrader: true, source: "gemini" })));
      setReasons(Object.fromEntries(draft.tools.map((t) => [t.id, t.reason])));
    });
  };

  const input = useMemo(
    () => ({
      name: name.trim(),
      instructions: instructions.trim(),
      model: "gemini" as const,
      enabledTools: [...tools],
      limits: { ...initial?.config.limits, maxModelCalls: maxCalls, maxEstimatedCostUsd: costCap },
      ...(mode === "create" && suggestedTests.length ? { testCases: suggestedTests } : {}),
    }),
    [name, instructions, tools, maxCalls, costCap, mode, suggestedTests, initial],
  );

  const specYaml = useMemo(
    () =>
      toYaml({
        name: input.name || "(unnamed)",
        model: input.model,
        instructions: input.instructions || "(empty)",
        enabledTools: input.enabledTools,
        requireWriteApproval: true,
        limits: input.limits,
      }),
    [input],
  );

  const canSave = input.name.length > 0 && input.instructions.length > 0 && maxCalls >= 1 && maxCalls <= 10 && costCap > 0 && costCap <= 1;

  const save = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const saved = mode === "create" ? await createAgent(input) : detail ? await updateAgent(detail.id, input) : null;
      if (!saved) return;
      setDetail(saved); setSaveNotice(`Saved v${saved.version}. Checking saved tests…`);
      try { const ran = await evaluateSavedAgent(saved.id); setSaveNotice(ran ? `Saved v${saved.version}; results are available in Tests.` : `Saved v${saved.version}. Add test cases before publishing.`); }
      catch { setSaveNotice(`Saved v${saved.version}. Automatic tests were unavailable; open Tests to retry.`); }
      if (mode === "create") router.push(`/agents/${saved.id}`);
      else router.refresh();
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
      setMaxCalls(updated.config.limits.maxModelCalls);
      setCostCap(updated.config.limits.maxEstimatedCostUsd);
      try { await evaluateSavedAgent(updated.id); } catch { setSaveNotice("Version restored. Open Tests to retry evaluation."); }
      router.refresh();
    } catch {
      setSaveError("Could not restore this version.");
    } finally {
      setWorking(false);
    }
  };


  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        {saveNotice && <p role="status" className="mb-4 rounded-lg border border-sky-400/30 bg-sky-400/10 p-3 text-sm">{saveNotice}</p>}
        {mode === "create" && suggestedTests.length > 0 && <p className="mb-4 text-sm text-sky-300">{suggestedTests.length} suggested tests will be saved and run with this agent. Review them in Tests.</p>}
        {/* Draft with Gemini */}
        <section className="mb-6 rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-sky-500/5 p-4">
          <label className="text-sm font-medium">✨ Draft with Gemini</label>
          <p className="mt-0.5 text-xs text-zinc-400">
            Describe what the agent should do; Gemini fills the form.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Answer customer returns questions from our policy docs"
              className="flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
            <button
              onClick={runDraft}
              disabled={drafting || goal.trim().length === 0}
              className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {drafting ? "Drafting…" : "Draft"}
            </button>
          </div>
          {draftError && (
            <p className="mt-2 text-xs text-red-300">{draftError}</p>
          )}
        </section>

        {/* Templates */}
        <section className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
            Start from a template
          </p>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.key}
                onClick={() => applyTemplate(t)}
                className="rounded-md border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b border-white/10 text-sm">
          {(["form", "spec"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 ${
                tab === t
                  ? "border-white text-white"
                  : "border-transparent text-zinc-400 hover:text-white"
              }`}
            >
              {t === "form" ? "Configure" : "Spec (YAML)"}
            </button>
          ))}
        </div>

        {tab === "form" ? (
          <div className="space-y-5">
            {assumptions.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <p className="font-medium">Gemini made assumptions:</p>
                <ul className="mt-1 list-disc pl-5 text-amber-100/90">
                  {assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-sky-400"
                placeholder="Support Agent"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={6}
                className="mt-1 w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-sky-400"
                placeholder="Describe how the agent should behave…"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Model</label>
              <div className="mt-1 inline-flex rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-zinc-300">
                Gemini 3.1 Flash-Lite
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">Model step limit<input type="number" min={1} max={10} value={maxCalls} onChange={event => setMaxCalls(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-white/15 bg-zinc-950 p-3" /></label>
              <label className="text-sm">Estimated model cost cap (USD)<input type="number" min={0.001} max={1} step={0.001} value={costCap} onChange={event => setCostCap(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-white/15 bg-zinc-950 p-3" /></label>
            </div>
            <div>
              <label className="text-sm font-medium">Tools</label>
              <p className="text-xs text-zinc-500">
                🔒 marks write tools that require human approval at run time.
              </p>
              <div className="mt-2 space-y-2">
                {catalog.map((tool) => (
                  <label
                    key={tool.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3 hover:border-white/25"
                  >
                    <input
                      type="checkbox"
                      checked={tools.has(tool.id)}
                      onChange={() => toggleTool(tool.id)}
                      className="mt-1"
                    />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 font-mono text-sm">
                        {tool.id}
                        {tool.requiresApproval && (
                          <span title="Requires approval">🔒</span>
                        )}
                      </span>
                      <span className="block text-xs text-zinc-400">
                        {tool.description}
                      </span>
                      {reasons[tool.id] && (
                        <span className="mt-1 block text-xs text-sky-300">
                          Gemini: {reasons[tool.id]}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {saveError && (
              <p className="text-sm text-red-300">{saveError}</p>
            )}

            <button
              onClick={save}
              disabled={!canSave || saving}
              className="rounded-md bg-white px-5 py-2 text-sm font-medium text-black hover:bg-zinc-200 disabled:opacity-50"
            >
              {saving
                ? "Saving…"
                : mode === "create"
                  ? "Create agent"
                  : "Save new version"}
            </button>
          </div>
        ) : (
          <pre className="overflow-x-auto rounded-md border border-white/10 bg-black/40 p-4 font-mono text-xs leading-relaxed text-zinc-200">
            {specYaml}
          </pre>
        )}
      </div>

      {/* Right rail: versions + publish (edit mode only) */}
      {mode === "edit" && detail && (
        <aside className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Versions</h2>
              <span className="text-xs text-zinc-500">current v{detail.version}</span>
            </div>
            <ul className="mt-3 space-y-2">
              {detail.versions.map((v) => (
                <li
                  key={v.version}
                  className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    v{v.version}
                    {v.isCurrent && (
                      <span className="rounded bg-sky-500/20 px-1.5 text-xs text-sky-300">
                        current
                      </span>
                    )}
                    {v.isPublished && (
                      <span className="rounded bg-emerald-500/20 px-1.5 text-xs text-emerald-300">
                        published
                      </span>
                    )}
                  </span>
                  {!v.isCurrent && (
                    <button
                      onClick={() => onRollback(v.version)}
                      disabled={working}
                      className="text-xs text-zinc-300 hover:text-white disabled:opacity-50"
                    >
                      Roll back
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-sm font-medium">Publish</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Publishing marks the current version as production-ready.
            </p>
            <Link href={`/agents/${detail.id}/tests`} className="mt-3 inline-block text-sm text-sky-300 underline">Run tests and publish this version</Link>
            <p className="mt-2 text-xs text-zinc-400">Publish checks saved server results. A checkbox cannot approve a release.</p>
            {detail.published && (
              <p className="mt-2 text-xs text-emerald-300">
                Published v{detail.publishedVersion}
              </p>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
