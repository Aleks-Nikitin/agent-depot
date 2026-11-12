import { z } from "zod";
const sources = z.object({ sample: z.boolean().optional(), matches: z.array(z.object({ title: z.string(), text: z.string(),
  citation: z.object({ documentId: z.string(), version: z.number().int(), startLine: z.number().int(), endLine: z.number().int(), contentHash: z.string() }) })).max(4) });
export function KnowledgeSources({ output }: { output: unknown }) {
  const parsed = sources.safeParse(output); if (!parsed.success) return null;
  return <div className="mt-4 space-y-3"><h3 className="text-sm font-semibold">Retrieved sources{parsed.data.sample ? " · illustrative samples" : ""}</h3>
    {!parsed.data.matches.length && <p className="text-sm text-(--ad-muted)">No matching source was found. This retrieval does not support an answer.</p>}
    {parsed.data.matches.map((source, index) => <figure key={index} className="rounded-lg border border-(--ad-border) p-3">
      <figcaption className="text-xs text-(--ad-model)">{source.title} · v{source.citation.version} · lines {source.citation.startLine}–{source.citation.endLine}</figcaption>
      <blockquote className="mt-2 whitespace-pre-wrap text-sm text-(--ad-muted)">{source.text}</blockquote>
      <details className="mt-2 text-xs"><summary>Citation identity</summary><p className="break-all">{source.citation.documentId} · {source.citation.contentHash}</p></details>
    </figure>)}
  </div>;
}
