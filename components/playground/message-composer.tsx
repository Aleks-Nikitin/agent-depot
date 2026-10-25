"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";

/** Enter sends, Shift+Enter adds a new line. Disabled while a run is active. */
export function MessageComposer({ onSend, disabled, initial = "" }: { onSend: (message: string) => void; disabled?: boolean; initial?: string }) {
  const [value, setValue] = useState(initial);
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const message = value.trim();
    if (!message || disabled) return;
    onSend(message);
    setValue("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
  return (
    <form onSubmit={send} className="rounded-xl border border-(--ad-border) bg-(--ad-raised) focus-within:border-(--ad-muted)/50">
      <label htmlFor="playground-message" className="sr-only">Message the agent</label>
      <textarea id="playground-message" value={value} onChange={e => setValue(e.target.value)} onKeyDown={onKeyDown}
        placeholder="Message the agent…" rows={2} maxLength={8000}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] placeholder:text-(--ad-muted)/70 focus:outline-none" />
      <div className="flex items-center justify-end gap-3 border-t border-(--ad-border) px-3 py-2.5">
        <span className="ad-mono hidden text-xs text-(--ad-muted) sm:inline">Enter to send · Shift+Enter for new line</span>
        <Button type="submit" variant="primary" size="sm" disabled={disabled || !value.trim()}>Send ↑</Button>
      </div>
    </form>
  );
}
