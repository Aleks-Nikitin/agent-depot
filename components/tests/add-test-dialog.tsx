"use client";

import { useState, type FormEvent, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EditIcon, PlusIcon, SparkIcon } from "@/components/ui/icons";
import { fieldClass, Input, Label, Switch, Textarea } from "@/components/ui/input";
import { Chip } from "@/components/ui/pill";
import { TestCaseInputSchema, type TestCaseInput } from "@/lib/evals/schema";
import type { TestCase } from "@/lib/evals/types";

export type FieldErrors = Partial<Record<keyof TestCaseInput | "form", string>>;

/** First message per top-level field from Zod (or server) issues. */
export function fieldErrorsFrom(issues: Array<{ path: PropertyKey[]; message: string }>): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = (typeof issue.path[0] === "string" ? issue.path[0] : "form") as keyof FieldErrors;
    errors[key] ??= issue.message;
  }
  return errors;
}

const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? <p id={id} role="alert" className="mt-1.5 text-[13px] text-(--ad-error)">{message}</p> : null;

function ToolPicker({ id, label, value, onChange, tools, tone, error }: {
  id: string; label: string; value: string[]; onChange: (v: string[]) => void; tools: readonly string[]; tone: "tool" | "error"; error?: string;
}) {
  const remaining = tools.filter(t => !value.includes(t));
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className={`flex min-h-12 flex-wrap items-center gap-2 rounded-lg border bg-(--ad-raised) p-2 ${error ? "border-(--ad-error-border)" : "border-(--ad-border)"}`}>
        {value.map(t => <Chip key={t} tone={tone === "error" ? "error" : "neutral"} onRemove={() => onChange(value.filter(x => x !== t))}>{t}</Chip>)}
        {remaining.length > 0 && (
          <select id={id} value="" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
            onChange={e => e.target.value && onChange([...value, e.target.value])}
            className="ad-mono h-7 cursor-pointer rounded-md bg-transparent px-1 text-xs text-(--ad-muted) hover:text-(--ad-text) focus:outline-none">
            <option value="">+ Add</option>
            {remaining.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/**
 * Add / Edit test case form, shown as a side panel next to the cases (it was planned as a dialog).
 * Validates with TestCaseInputSchema; onSubmit returns server field errors, if any. Remount (key) to switch cases.
 */
export function AddTestDialog({ tools, initial, onSubmit, onCancel, inputRef }: {
  tools: readonly string[];
  initial?: TestCase | null;
  onSubmit: (input: TestCaseInput) => Promise<FieldErrors | null>;
  onCancel?: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const [input, setInput] = useState(initial?.input ?? "");
  const [mustCall, setMustCall] = useState<string[]>(initial?.mustCall ?? []);
  const [mustNotCall, setMustNotCall] = useState<string[]>(initial?.mustNotCall ?? []);
  const [mustContain, setMustContain] = useState<string[]>(initial?.mustContain ?? []);
  const [word, setWord] = useState("");
  const [useGrader, setUseGrader] = useState(initial?.useGrader ?? false);
  const [expectedBehavior, setExpectedBehavior] = useState(initial?.expectedBehavior ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const editing = !!initial;

  const reset = () => { setInput(""); setMustCall([]); setMustNotCall([]); setMustContain([]); setWord(""); setUseGrader(false); setExpectedBehavior(""); setErrors({}); };
  const addWord = () => {
    const w = word.trim();
    if (!w) { setErrors(e => ({ ...e, mustContain: "Phrases can't be empty" })); return; }
    if (!mustContain.includes(w)) setMustContain([...mustContain, w]);
    setWord(""); setErrors(e => ({ ...e, mustContain: undefined }));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = TestCaseInputSchema.safeParse({ input, mustCall, mustNotCall, mustContain, useGrader,
      ...(expectedBehavior.trim() ? { expectedBehavior: expectedBehavior.trim() } : {}), source: initial?.source ?? "user" });
    if (!parsed.success) { setErrors(fieldErrorsFrom(parsed.error.issues)); return; }
    setSaving(true);
    const serverErrors = await onSubmit(parsed.data);
    setSaving(false);
    if (serverErrors) { setErrors(serverErrors); return; }
    if (!editing) reset();
  };

  return (
    <Card className="p-5">
      <form onSubmit={submit} noValidate className="space-y-5">
        <div className="flex items-center justify-between border-b border-(--ad-border) pb-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            {editing ? <><EditIcon /> Edit test case</> : <><PlusIcon /> New test case</>}
          </h2>
          <span className="ad-mono text-xs text-(--ad-muted)">Custom assertion</span>
        </div>
        <div>
          <Label htmlFor="test-input">User question (input)</Label>
          <Textarea id="test-input" ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            aria-invalid={!!errors.input} aria-describedby={errors.input ? "test-input-error" : undefined}
            className={errors.input ? "border-(--ad-error-border)" : undefined}
            placeholder="e.g. Can you expedite my delivery to Canada?" maxLength={8000} />
          <FieldError id="test-input-error" message={errors.input} />
        </div>
        <ToolPicker id="must-call" label="Must call tool" value={mustCall} onChange={setMustCall} tone="tool" error={errors.mustCall}
          tools={tools.filter(t => !mustNotCall.includes(t))} />
        <ToolPicker id="must-not-call" label="Must not call tool" value={mustNotCall} onChange={setMustNotCall} tone="error" error={errors.mustNotCall}
          tools={tools.filter(t => !mustCall.includes(t))} />
        <div>
          <Label htmlFor="must-contain">Answer must contain</Label>
          <div className="flex gap-2">
            <Input id="must-contain" value={word} onChange={e => setWord(e.target.value)} placeholder="e.g. tracking number"
              aria-invalid={!!errors.mustContain} aria-describedby={errors.mustContain ? "must-contain-error" : undefined}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addWord(); } }} />
            <Button onClick={addWord}>Add</Button>
          </div>
          <FieldError id="must-contain-error" message={errors.mustContain} />
          {mustContain.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {mustContain.map(w => <Chip key={w} onRemove={() => setMustContain(mustContain.filter(x => x !== w))}>&ldquo;{w}&rdquo;</Chip>)}
            </div>
          )}
        </div>
        <div className={`${fieldClass} flex flex-wrap items-center justify-between gap-4 py-3`}>
          <div>
            <p className="flex items-center gap-2 text-sm font-medium"><SparkIcon size={14} /> Grade with Gemini</p>
            <p className="mt-0.5 text-[13px] text-(--ad-muted)">Checks the answer follows the agent&apos;s policy</p>
          </div>
          <Switch checked={useGrader} onChange={setUseGrader} label="Grade with Gemini" />
          {useGrader && <label className="mt-3 block text-sm">Expected behavior (optional)<Textarea value={expectedBehavior} onChange={event => setExpectedBehavior(event.target.value)} maxLength={2000} placeholder="Describe what a correct answer should do." className="mt-2" /></label>}
        </div>
        <FieldError id="test-form-error" message={errors.form ?? errors.source ?? errors.useGrader ?? errors.expectedBehavior} />
        <div className="flex items-center justify-end gap-2 border-t border-(--ad-border) pt-4">
          <Button variant="ghost" disabled={saving} onClick={() => { reset(); onCancel?.(); }}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save test"}</Button>
        </div>
      </form>
    </Card>
  );
}
