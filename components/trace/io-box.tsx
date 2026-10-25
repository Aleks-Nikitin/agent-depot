import { Inset } from "@/components/ui/card";

export function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** INPUT / OUTPUT box with mono JSON. Long values scroll inside the box, never the page. */
export function IoBox({ label, value }: { label: string; value: unknown }) {
  return (
    <Inset label={label} className="bg-(--ad-bg)/60">
      <pre className="ad-mono max-h-56 overflow-auto text-xs leading-relaxed break-words whitespace-pre-wrap text-(--ad-text)/90">
        {formatValue(value)}
      </pre>
    </Inset>
  );
}
