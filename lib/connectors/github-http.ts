import { z } from "zod";
import { IssueResultSchema } from "./contracts";

export class ConnectorError extends Error {
  constructor(readonly reason: string, readonly definitive = false) { super(reason); }
}
export async function githubRequest(repository: string, token: string, suffix: string, options: { signal: AbortSignal; body?: unknown; fetcher?: typeof fetch }) {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(8000)]);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`https://api.github.com/repos/${repository}${suffix}`, {
      method: options.body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json" },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch { throw new ConnectorError("connector_outcome_unknown"); }
  if (!response.ok) {
    await response.body?.cancel();
    const definitive = [400, 401, 403, 404, 422, 429].includes(response.status);
    throw new ConnectorError(response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
      ? "connector_rate_limited" : [401, 403, 404].includes(response.status) ? "connector_access_denied" : "connector_request_failed", definitive);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ConnectorError("connector_response_invalid");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const value = await reader.read(); if (value.done) break;
      bytes += value.value.byteLength;
      if (bytes > 524_288) throw new Error();
      chunks.push(value.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8").replaceAll(token, "[redacted]")) as unknown;
  } catch { throw new ConnectorError("connector_response_invalid"); }
  finally { await reader.cancel().catch(() => {}); }
}
export const GitHubIssueSchema = z.object({ number: z.number().int().positive(), title: z.string().max(300), body: z.string().nullable().optional(), pull_request: z.unknown().optional() });
export function issueResult(repository: string, raw: unknown) {
  const issue = GitHubIssueSchema.parse(raw);
  return IssueResultSchema.parse({ number: issue.number, title: issue.title, url: `https://github.com/${repository}/issues/${issue.number}` });
}
