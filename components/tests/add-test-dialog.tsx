"use client";

import { useState, type FormEvent, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlusIcon, SparkIcon } from "@/components/ui/icons";
import { fieldClass, Input, Label, Switch, Textarea } from "@/components/ui/input";
import { Chip } from "@/components/ui/pill";
import type { TestCase } from "@/lib/evals/types";

function ToolPicker({ id, label, value, onChange, tools, tone }: {
  id: string; label: string; value: string[]; onChange: (v: string[]) => void; tools: string[]; tone: "tool" | "error";
}) {
  const remaining = tools.filter(t => !value.includes(t));
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-(--ad-border) bg-(--ad-raised) p-2">
        {value.map(t => <Chip key={t} tone={tone === "error" ? "error" : "neutral"} onRemove={() => onChange(value.filter(x => x !== t))}>{t}</Chip>)}
        {remaining.length > 0 && (
          <select id={id} value="" onChange={e => e.target.value && onChange([...value, e.target.value])}
            className="ad-mono h-7 cursor-pointer rounded-md bg-transparent px-1 text-xs text-(--ad-muted) hover:text-(--ad-text) focus:outline-none">
            <option value="">+ Add</option>
            {remaining.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

/**
 * "New test case" form. Shown as a side panel next to the cases, as in the design (it was planned as a dialog).
 * A case needs a question and at least one check.
 */
export function AddTestDialog({ tools, onSave, inputRef }: {
  tools: string[]; onSave: (c: Omit<TestCase, "id">) => void; inputRef?: Ref<HTMLTextAreaElement>;
}) {
    const [input, setInput] = useState("");
    const [mustCall, setMustCall] = useState<string[]>([]);
    const [mustNotCall, setMustNotCall] = useState<string[]>([]);
    const [mustContain, setMustContain] = useState<string[]>([]);
    const [word, setWord] = useState("");
    const [useGrader, setUseGrader] = useState(false);

    const reset = () => { setInput(""); setMustCall([]); setMustNotCall([]); setMustContain([]); setWord(""); setUseGrader(false); };
    const addWord = () => { const w = word.trim(); if (w && !mustContain.includes(w)) setMustContain([...mustContain, w]); setWord(""); };
    const hasCheck = mustCall.length + mustNotCall.length + mustContain.length > 0 || useGrader;
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (!input.trim() || !hasCheck) return;
      onSave({ input: input.trim(), mustCall, mustNotCall, mustContain, useGrader, source: "user" });
      reset();
    };

    return (
      <Card className="p-5">
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center justify-between border-b border-(--ad-border) pb-4">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><PlusIcon /> New test case</h2>
            <span className="ad-mono text-xs text-(--ad-muted)">Custom assertion</span>
          </div>
          <div>
            <Label htmlFor="test-input">User question (input)</Label>
            <Textarea id="test-input" ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              placeholder="e.g. Can you expedite my delivery to Canada?" maxLength={8000} />
          </div>
          <ToolPicker id="must-call" label="Must call tool" value={mustCall} onChange={setMustCall} tone="tool"
            tools={tools.filter(t => !mustNotCall.includes(t))} />
          <ToolPicker id="must-not-call" label="Must not call tool" value={mustNotCall} onChange={setMustNotCall} tone="error"
            tools={tools.filter(t => !mustCall.includes(t))} />
          <div>
            <Label htmlFor="must-contain">Answer must contain</Label>
            <div className="flex gap-2">
              <Input id="must-contain" value={word} onChange={e => setWord(e.target.value)} placeholder="e.g. tracking number"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addWord(); } }} />
              <Button onClick={addWord} disabled={!word.trim()}>Add</Button>
            </div>
            {mustContain.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {mustContain.map(w => <Chip key={w} onRemove={() => setMustContain(mustContain.filter(x => x !== w))}>&ldquo;{w}&rdquo;</Chip>)}
              </div>
            )}
          </div>
          <div className={`${fieldClass} flex items-center justify-between gap-4 py-3`}>
            <div>
              <p className="flex items-center gap-2 text-sm font-medium"><SparkIcon size={14} /> Grade with Gemini</p>
              <p className="mt-0.5 text-[13px] text-(--ad-muted)">Checks the answer follows the agent&apos;s policy</p>
            </div>
            <Switch checked={useGrader} onChange={setUseGrader} label="Grade with Gemini" />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-(--ad-border) pt-4">
            <Button variant="ghost" onClick={reset}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!input.trim() || !hasCheck}>Save test</Button>
          </div>
        </form>
      </Card>
    );
}
