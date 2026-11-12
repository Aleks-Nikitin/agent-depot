import { HttpError } from "@/lib/auth/errors";
import { withCancellation } from "@/lib/agents/runtime/cancellation";

export async function readKnowledgeUpload(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new HttpError(415, "knowledge_upload_type");
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "invalid_body");
  const chunks: Uint8Array[] = []; let size = 0;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  try {
    while (true) {
      const part = await withCancellation(signal, () => reader.read()); if (part.done) break;
      size += part.value.byteLength; if (size > 131_072) throw new HttpError(413, "knowledge_upload_too_large"); chunks.push(part.value);
    }
    const form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type")! }, body: Buffer.concat(chunks) }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || !/\.(txt|md)$/i.test(file.name) || !["", "text/plain", "text/markdown", "application/octet-stream"].includes(file.type)) throw new HttpError(415, "knowledge_upload_type");
    if (file.size < 1 || file.size > 100_000) throw new HttpError(413, "knowledge_upload_too_large");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()).replace(/\r\n?/g, "\n").trim(); }
    catch { throw new HttpError(400, "knowledge_upload_encoding"); }
    return { sourceName: file.name, title: String(form.get("title") || file.name), text, access: String(form.get("access") || "workspace"),
      agentIds: form.getAll("agentId").map(String), id: typeof form.get("documentId") === "string" ? String(form.get("documentId")) : undefined,
      expectedVersion: form.has("expectedVersion") ? Number(form.get("expectedVersion")) : undefined };
  } finally { void reader.cancel().catch(() => {}); }
}
