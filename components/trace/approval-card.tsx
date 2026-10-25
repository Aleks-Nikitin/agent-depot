import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { approvalState, type ApprovalItem } from "@/lib/playground/reduce-events";
import { formatValue } from "./io-box";

type Email = { to: string; subject: string; body: string };
const isEmail = (v: unknown): v is Email =>
  !!v && typeof v === "object" && ["to", "subject", "body"].every(k => typeof (v as Record<string, unknown>)[k] === "string");

const stateLabel = {
  pending: "Intervention required",
  approved: "Approved",
  rejected: "Rejected · not sent",
  expired: "Expired · start a new run",
} as const;

/**
 * The exact proposed write and the human decision. Policy, not the model, decides that this card appears.
 * Buttons only render for a pending approval when onDecide is given (read-only in run history).
 */
export function ApprovalCard({ item, now, onDecide, busy }: {
  item: ApprovalItem; now?: number; onDecide?: (approved: boolean) => void; busy?: boolean;
}) {
  const state = approvalState(item, now);
  const pending = state === "pending";
  return (
    <div className={cn("min-w-0 rounded-xl border-2 p-4 sm:p-5",
      pending ? "border-(--ad-approval-border) bg-(--ad-approval-bg)/50" : "border-(--ad-border) bg-(--ad-surface)")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className="ad-mono inline-flex min-h-7 items-center rounded-md border border-(--ad-approval-border) bg-(--ad-approval-bg) px-2.5 text-xs text-(--ad-approval)">
          Approval needed · {item.toolId}
        </span>
        <span className="text-sm text-(--ad-muted)">Write tool · approval enforced by policy</span>
        <span className={cn("ad-mono ml-auto text-xs tracking-wider uppercase",
          state === "approved" ? "text-(--ad-success)" : state === "pending" ? "text-(--ad-approval)" : "text-(--ad-error)")}>
          {stateLabel[state]}
        </span>
      </div>

      <div className="mt-4 rounded-lg border border-(--ad-border) bg-(--ad-bg)/70 p-4">
        {isEmail(item.input) ? (
          <div className="text-sm">
            <p className="ad-mono border-b border-(--ad-border) pb-2.5 text-[13px]"><span className="text-(--ad-muted)">To:</span> {item.input.to}</p>
            <p className="ad-mono border-b border-(--ad-border) py-2.5 text-[13px]"><span className="text-(--ad-muted)">Subject:</span> {item.input.subject}</p>
            <p className="pt-3 leading-relaxed">{item.input.body}</p>
          </div>
        ) : (
          <pre className="ad-mono max-h-56 overflow-auto text-xs break-words whitespace-pre-wrap">{formatValue(item.input)}</pre>
        )}
      </div>

      {pending && onDecide && (
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button variant="danger" disabled={busy} onClick={() => onDecide(false)}><XIcon /> Reject</Button>
          <Button variant="primary" disabled={busy} onClick={() => onDecide(true)}><CheckIcon /> Approve</Button>
        </div>
      )}
    </div>
  );
}
