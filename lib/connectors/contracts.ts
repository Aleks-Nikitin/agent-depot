import { z } from "zod";

export const GitHubBindingSchema = z.object({
  connectionId: z.string().uuid(), revision: z.number().int().positive(),
}).strict();
export const GitHubConnectionInputSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/).refine(v => !v.endsWith("/.") && !v.endsWith("/..")),
  token: z.string().min(20).max(500).regex(/^[A-Za-z0-9_]+$/),
  allowWrites: z.boolean().default(false),
}).strict();
export const IssueDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(6000).refine(v => !v.includes("agent-depot-operation:")),
}).strict();
export const IssueListSchema = z.object({ state: z.enum(["open", "closed", "all"]).default("open") }).strict();
export const IssueResultSchema = z.object({ number: z.number().int().positive(), title: z.string().max(300), url: z.string().url().max(500) }).strict();
export const GITHUB_TOOLS = ["github_list_issues", "github_create_issue"] as const;

export const githubCapability = Object.freeze({
  implementationVersion: "github-issues-v1", service: "github", trigger: "manual",
  resourceScope: "one explicitly connected repository", credentialSource: "encrypted workspace credential",
  reads: ["github_list_issues"], writes: ["github_create_issue"],
  approval: "exact normalized issue title and body; pinned connection revision",
  recovery: "durable intent before POST; ambiguous results require read-only reconciliation, never repost",
  evaluation: "external calls disabled",
});
