"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "./cn";
import { XIcon } from "./icons";

/** Native <dialog> modal: focus trapping, Escape and backdrop come from the browser. */
export function Dialog({ open, onClose, title, children, footer, className }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onCancel={onClose}
      className={cn("ad m-auto w-[min(560px,calc(100vw-32px))] rounded-xl border border-(--ad-border) bg-(--ad-surface) p-0 text-(--ad-text) backdrop:bg-black/70", className)}>
      <div className="flex items-center justify-between border-b border-(--ad-border) px-5 py-4">
        <h2 id={titleId} className="text-[15px] font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded-lg text-(--ad-muted) hover:bg-(--ad-raised) hover:text-(--ad-text)">
          <XIcon />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-(--ad-border) px-5 py-4">{footer}</div>}
    </dialog>
  );
}
