"use client";

import { toolLabel } from "@/lib/agents/tool-labels";
import { useMemo, useState, useTransition, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { Dialog } from "@/components/ui/dialog";
import AuthClientPage from "@/app/auth/auth-client";
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
  initialTemplate?: AgentTemplate;
  workspaceName?: string;
  githubEnabled?: boolean;
};

type Tab = "form" | "spec";

export default function AgentBuilder({ mode, catalog, templates, initial, initialTemplate, workspaceName = "Guest", githubEnabled = false }: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const [authOpen, setAuthOpen] = useState(false);
  const [companyName, setCompanyName] = useState(initial?.config.workspaceName ?? workspaceName);
  const personalize = (value: string) => value.replaceAll("{{workspace}}", companyName);


  const [name, setName] = useState(initial?.name ?? initialTemplate?.name.replaceAll("{{workspace}}", workspaceName) ?? "");
  const [instructions, setInstructions] = useState(initial?.config.instructions ?? initialTemplate?.instructions.replaceAll("{{workspace}}", workspaceName) ?? "");
  const [tools, setTools] = useState<Set<string>>(
    new Set(initial?.config.enabledTools ?? initialTemplate?.enabledTools ?? []),
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
  const [suggestedTests, setSuggestedTests] = useState<TestCaseInput[]>(initialTemplate?.testCases ?? []);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [maxWrites, setMaxWrites] = useState(initial?.config.limits.maxWriteCalls ?? 2);
  const [maxCalls, setMaxCalls] = useState(initial?.config.limits.maxModelCalls ?? 5);
  const [costCap, setCostCap] = useState(initial?.config.limits.maxEstimatedCostUsd ?? 0.05);
  const [requireWriteApproval, setRequireWriteApproval] = useState(initial?.config.requireWriteApproval ?? false);
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
    setName(personalize(template.name));
    setInstructions(personalize(template.instructions));
    setTools(new Set(template.enabledTools));
    setAssumptions([]);
    setReasons({});
    setSuggestedTests(template.testCases ?? []);
    if (mode === "edit") setSaveNotice("Template applied to the configuration. Existing tests are kept; review them in Tests after saving.");
  };

  const runDraft = () => {
    if (!session) { requestSignIn(); return; }
    setDraftError(null);
    startDraft(async () => {
      const result = await draftAgentAction(goal);
      if (!result.ok) {
        setDraftError(result.error);
        return;
      }
      const draft = result.draft;
      setName(draft.name);
      if (mode === "edit") setSaveNotice("Draft applied. Existing tests are kept; review them in Tests after saving.");
      setInstructions(draft.instructions);
      setTools(new Set(draft.tools.map((t) => t.id)));
      setAssumptions(draft.assumptions);
      setSuggestedTests(draft.suggestedTests.slice(0, 5).map(test => TestCaseInputSchema.parse({ ...test, useGrader: true, source: "gemini" })));
      setReasons(Object.fromEntries(draft.tools.map((t) => [t.id, t.reason])));
    });
  };

  const input = useMemo(
    () => ({
      name: name.trim(),
      workspaceName: companyName.trim(),
      instructions: instructions.trim(),
      model: "gemini" as const,
      enabledTools: [...tools].filter(id => catalog.some(tool => tool.id === id)),
      requireWriteApproval,
      limits: { ...initial?.config.limits, maxModelCalls: maxCalls, maxWriteCalls: maxWrites, maxEstimatedCostUsd: costCap },
      ...(mode === "create" && suggestedTests.length ? { testCases: suggestedTests } : {}),
    }),
    [catalog, name, companyName, instructions, tools, requireWriteApproval, maxCalls, maxWrites, costCap, mode, suggestedTests, initial],
  );

  const specYaml = useMemo(
    () =>
      toYaml({
        name: input.name || "(unnamed)",
        model: input.model,
        workspaceName: input.workspaceName,
        instructions: input.instructions || "(empty)",
        enabledTools: input.enabledTools,
        requireWriteApproval: input.requireWriteApproval,
        limits: input.limits,
      }),
    [input],
  );

  const canSave = companyName.trim().length > 0 && input.name.length > 0 && input.instructions.length > 0 && Number.isInteger(maxCalls) && Number.isInteger(maxWrites) && maxWrites >= 1 && maxWrites <= 5 && maxCalls >= 1 && maxCalls <= 10 && costCap > 0 && costCap <= 1;

  const save = async () => {
    if (!session) { requestSignIn(); return; }
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

  function requestSignIn() {
    try { sessionStorage.setItem("agent-builder-pending", JSON.stringify({ name, instructions, tools: [...tools], companyName, goal, suggestedTests, maxCalls, maxWrites, costCap, requireWriteApproval })); } catch { /* Sign-in still works when tab storage is unavailable. */ }
    setAuthOpen(true);
  }
  useEffect(() => {
    let pending: string | null = null;
    try { pending = sessionStorage.getItem("agent-builder-pending"); } catch { return; }
    if (!pending || mode !== "create") return;
    try {
      const value = JSON.parse(pending);
      // Restore only this tab's bounded form fields after an OAuth round trip.
      if (typeof value.name === "string" && typeof value.instructions === "string" && Array.isArray(value.tools)) {
        /* eslint-disable react-hooks/set-state-in-effect */
        setName(value.name.slice(0, 100)); setInstructions(value.instructions.slice(0, 8000));
        setTools(new Set(value.tools.filter((id: unknown): id is string => typeof id === "string" && catalog.some(tool => tool.id === id))));
        if (typeof value.companyName === "string") setCompanyName(value.companyName.slice(0, 80));
        if (Number.isInteger(value.maxWrites) && value.maxWrites >= 1 && value.maxWrites <= 5) setMaxWrites(value.maxWrites);
        if (Number.isInteger(value.maxCalls) && value.maxCalls >= 1 && value.maxCalls <= 10) setMaxCalls(value.maxCalls);
        if (typeof value.costCap === "number" && Number.isFinite(value.costCap) && value.costCap > 0 && value.costCap <= 1) setCostCap(value.costCap);
        if (typeof value.requireWriteApproval === "boolean") setRequireWriteApproval(value.requireWriteApproval);
        if (typeof value.goal === "string") setGoal(value.goal.slice(0, 8000));
        if (Array.isArray(value.suggestedTests)) setSuggestedTests(value.suggestedTests.slice(0, 5).flatMap((test: unknown) => { const parsed = TestCaseInputSchema.safeParse(test); return parsed.success ? [parsed.data] : []; }));
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch { /* Invalid tab-local drafts are ignored. */ }
    try { sessionStorage.removeItem("agent-builder-pending"); } catch {}
  }, [mode, catalog]);

  useEffect(() => {
    if (!session?.user || session.user.isAnonymous || companyName !== "Guest" || !name.startsWith("Guest's")) return;
    const label = session.user.name.trim().slice(0, 80);
    if (!label || label === "Guest") return;
    // Preserve the public draft while personalizing the starter after account creation.
    /* eslint-disable react-hooks/set-state-in-effect */
    setCompanyName(label); setName(text => text.replace("Guest's", `${label}'s`).slice(0, 100));
    setInstructions(text => text.replaceAll("Guest's", `${label}'s`));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [session, companyName, name]);

  const onRollback = async (version: number) => {
    if (!detail) return;
    setWorking(true);
    try {
      const updated = await rollbackAgent(detail.id, version);
      setDetail(updated);
      setName(updated.name);
      setInstructions(updated.config.instructions);
      setTools(new Set(updated.config.enabledTools));
      setCompanyName(updated.config.workspaceName ?? workspaceName);
      setRequireWriteApproval(updated.config.requireWriteApproval);
      setMaxWrites(updated.config.limits.maxWriteCalls);
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
      <Dialog open={authOpen} onClose={() => { setAuthOpen(false); try { sessionStorage.removeItem("agent-builder-pending"); } catch {} }} title="Save your agent workspace" className="max-h-[90vh] overflow-y-auto"><AuthClientPage githubEnabled={githubEnabled} callbackFailed={false} embedded callbackURL="/agents/new" onAuthenticated={() => { setAuthOpen(false); try { sessionStorage.removeItem("agent-builder-pending"); } catch {} }} /></Dialog>
      <div>
        {saveNotice && <p role="status" className="mb-4 rounded-lg border border-(--ad-model-border) bg-(--ad-model-bg) p-3 text-sm">{saveNotice}</p>}
        {mode === "create" && suggestedTests.length > 0 && <p className="mb-4 text-sm text-(--ad-model)">{suggestedTests.length} suggested tests will be saved and run with this agent. Review them in Tests.</p>}
        {/* Draft with Gemini */}
        <section className="mb-6 rounded-lg border border-(--ad-border) bg-(--ad-surface) p-4">
          <label className="text-sm font-medium">✨ Draft with Gemini</label>
          <p className="mt-0.5 text-xs text-(--ad-muted)">
            Describe what the agent should do; Gemini fills the form.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Answer customer returns questions from our policy docs"
              className="flex-1 rounded-md border border-(--ad-border) bg-(--ad-surface) px-3 py-2 text-sm outline-none focus:border-(--ad-model)"
            />
            <button
              onClick={runDraft}
              disabled={drafting || goal.trim().length === 0}
              className="rounded-md bg-(--ad-text) px-4 py-2 text-sm font-medium text-(--ad-bg) hover:opacity-90 disabled:opacity-50"
            >
              {drafting ? "Drafting…" : "Draft"}
            </button>
          </div>
          {draftError && (
            <p className="mt-2 text-xs text-(--ad-error)">{draftError}</p>
          )}
        </section>

        <label className="mb-6 block text-sm">Store or workspace name<input value={companyName} maxLength={80} onChange={event => {
          const next = event.target.value; const old = companyName;
          setCompanyName(next); if (name === `${old}'s Customer Support`) setName(`${next}'s Customer Support`);
          setInstructions(text => text.replaceAll(`${old}'s`, `${next}'s`));
        }} className="mt-2 block w-full rounded-md border border-(--ad-border) bg-(--ad-surface) px-3 py-2" /><span className="mt-2 block text-xs text-(--ad-muted)">Used by starter templates. Edit the agent name and instructions as needed.</span></label>
        <label className="mb-6 flex items-start gap-3 text-sm"><input type="checkbox" checked={requireWriteApproval} onChange={event => setRequireWriteApproval(event.target.checked)} /><span>Require review for other write tools<span className="mt-1 block text-xs text-(--ad-muted)">Internal tickets always create immediately, even when this option is on. This policy applies to any other write tools added later. Tests never execute writes.</span></span></label>
        {/* Templates */}
        <section className="mb-6">
          <p className="mb-2 text-xs uppercase tracking-wide text-(--ad-muted)">
            Start from a template
          </p>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.key}
                onClick={() => applyTemplate(t)}
                className="rounded-md border border-(--ad-border) px-3 py-1.5 text-sm hover:bg-(--ad-raised)"
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b border-(--ad-border) text-sm">
          {(["form", "spec"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 ${
                tab === t
                  ? "border-(--ad-text) text-(--ad-text)"
                  : "border-transparent text-(--ad-muted) hover:text-(--ad-text)"
              }`}
            >
              {t === "form" ? "Configure" : "Spec (YAML)"}
            </button>
          ))}
        </div>

        {tab === "form" ? (
          <div className="space-y-5">
            {assumptions.length > 0 && (
              <div className="rounded-md border border-(--ad-approval-border) bg-(--ad-approval-bg) px-4 py-3 text-sm text-(--ad-approval)">
                <p className="font-medium">Gemini made assumptions:</p>
                <ul className="mt-1 list-disc pl-5 text-(--ad-approval)">
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
                className="mt-1 w-full rounded-md border border-(--ad-border) bg-(--ad-surface) px-3 py-2 text-sm outline-none focus:border-(--ad-model)"
                placeholder="Support Agent"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={6}
                className="mt-1 w-full rounded-md border border-(--ad-border) bg-(--ad-surface) px-3 py-2 text-sm outline-none focus:border-(--ad-model)"
                placeholder="Describe how the agent should behave…"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Model</label>
              <div className="mt-1 inline-flex rounded-md border border-(--ad-border) bg-(--ad-surface) px-3 py-2 text-sm text-(--ad-text)">
                Gemini 3.1 Flash-Lite
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">Model step limit<input type="number" min={1} max={10} value={maxCalls} onChange={event => setMaxCalls(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-(--ad-border) bg-(--ad-surface) p-3" /></label>
              <label className="text-sm">Write action limit<input type="number" min={1} max={5} step={1} value={maxWrites} onChange={event => setMaxWrites(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-(--ad-border) bg-(--ad-surface) p-3" /></label>
              <label className="text-sm">Estimated model cost cap (USD)<input type="number" min={0.001} max={1} step={0.001} value={costCap} onChange={event => setCostCap(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-(--ad-border) bg-(--ad-surface) p-3" /></label>
            </div>
            <div>
              <label className="text-sm font-medium">Tools</label>
              <p className="text-xs text-(--ad-muted)">
                Tickets are created immediately and appear in Tools & knowledge. No external messages are sent. Tests never execute writes.
              </p>
              {tools.has("send_email") && <p className="mt-2 text-sm text-amber-300">Email has been removed because it did not deliver messages. Saving removes it from this agent. Internal support tickets remain available.</p>}
              <div className="mt-2 space-y-2">
                {catalog.map((tool) => (
                  <label
                    key={toolLabel(tool.id)}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-(--ad-border) bg-(--ad-surface) p-3 hover:border-(--ad-muted)"
                  >
                    <input
                      type="checkbox"
                      disabled={!!tool.unavailableReason && !tools.has(tool.id)}
                      checked={tools.has(tool.id)}
                      onChange={() => toggleTool(tool.id)}
                      className="mt-1"
                    />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 font-mono text-sm">
                        {toolLabel(tool.id)}
                        {tool.kind === "write" && <span className="text-xs font-sans text-(--ad-model)">{tool.id === "create_ticket" ? "Creates immediately" : requireWriteApproval ? "Asks for approval" : "Runs automatically"}</span>}
                      </span>
                      <span className="block text-xs text-(--ad-muted)">
                        {tool.description}
                      </span>
                      {tool.unavailableReason && <span className="mt-2 block text-xs text-amber-300">{"Not connected: ask the administrator to set SERPAPI_API_KEY for live search."}</span>}
                      {reasons[tool.id] && (
                        <span className="mt-1 block text-xs text-(--ad-model)">
                          Gemini: {reasons[tool.id]}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {saveError && (
              <p className="text-sm text-(--ad-error)">{saveError}</p>
            )}

            <button
              onClick={save}
              disabled={!canSave || saving}
              className="rounded-md bg-(--ad-text) px-5 py-2 text-sm font-medium text-(--ad-bg) hover:opacity-90 disabled:opacity-50"
            >
              {saving
                ? "Saving…"
                : mode === "create"
                  ? "Create agent"
                  : "Save new version"}
            </button>
          </div>
        ) : (
          <pre className="overflow-x-auto rounded-md border border-(--ad-border) bg-(--ad-raised) p-4 font-mono text-xs leading-relaxed text-(--ad-text)">
            {specYaml}
          </pre>
        )}
      </div>

      {/* Right rail: versions + publish (edit mode only) */}
      {mode === "edit" && detail && (
        <aside className="space-y-4">
          <div className="rounded-lg border border-(--ad-border) bg-(--ad-surface) p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Versions</h2>
              <span className="text-xs text-(--ad-muted)">current v{detail.version}</span>
            </div>
            <ul className="mt-3 space-y-2">
              {detail.versions.map((v) => (
                <li
                  key={v.version}
                  className="flex items-center justify-between rounded-md border border-(--ad-border) px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    v{v.version}
                    {v.isCurrent && (
                      <span className="rounded bg-(--ad-model-bg) px-1.5 text-xs text-(--ad-model)">
                        current
                      </span>
                    )}
                    {v.isPublished && (
                      <span className="rounded bg-(--ad-success-bg) px-1.5 text-xs text-(--ad-success)">
                        published
                      </span>
                    )}
                  </span>
                  {!v.isCurrent && (
                    <button
                      onClick={() => onRollback(v.version)}
                      disabled={working}
                      className="text-xs text-(--ad-text) hover:text-(--ad-text) disabled:opacity-50"
                    >
                      Roll back
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-(--ad-border) bg-(--ad-surface) p-4">
            <h2 className="text-sm font-medium">Publish</h2>
            <p className="mt-1 text-xs text-(--ad-muted)">
              You can run this saved agent in Playground immediately. Publishing marks a tested revision as released; it does not unlock tickets or tool execution.
            </p>
            <Link href={`/agents/${detail.id}/tests`} className="mt-3 inline-block text-sm text-(--ad-model) underline">Run tests and publish this version</Link>
            <p className="mt-2 text-xs text-(--ad-muted)">Publish checks the latest saved results for this version and its current test definitions.</p>
            {detail.published && (
              <p className="mt-2 text-xs text-(--ad-success)">
                Published v{detail.publishedVersion}
              </p>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
