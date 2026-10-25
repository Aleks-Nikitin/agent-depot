import { AlertIcon } from "@/components/ui/icons";

/** Shown while Publish is locked, with the gate's reason. Dismissing it does not unlock Publish. */
export function PublishBanner({ reason, publishedVersion, firstFailingId, onDismiss }: {
  reason: string; publishedVersion: number | null; firstFailingId?: string; onDismiss: () => void;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-(--ad-error-border) bg-(--ad-error-bg) px-5 py-4">
      <AlertIcon className="shrink-0 text-(--ad-error)" />
      <p className="min-w-0 flex-1 text-[15px]">
        <span className="font-semibold text-(--ad-error)">Publish blocked: </span>
        {reason}.{firstFailingId ? ` Fix the agent${publishedVersion != null ? ` or roll back to v${publishedVersion}` : ""}.` : ""}
      </p>
      <div className="flex items-center gap-4 text-sm">
        {firstFailingId && <a href={`#test-${firstFailingId}`} className="text-(--ad-error) underline underline-offset-4">Jump to failing test</a>}
        <button type="button" onClick={onDismiss} className="text-(--ad-muted) hover:text-(--ad-text)">Dismiss</button>
      </div>
    </div>
  );
}
