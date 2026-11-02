import { z } from "zod";

// Browser-safe tool IDs for test forms; schema.test.ts keeps this list aligned with the trusted runtime.
export const REGISTERED_TOOL_IDS = ["knowledge_search", "sales_lookup", "order_lookup", "create_ticket", "send_email", "google_shopping", "google_news", "read_webpage"] as const;
/** Planned integrations (Dev 4): allowed in tests before they are registered. */
export const PLANNED_TOOL_IDS = [] as const;
export const TOOL_IDS = [...REGISTERED_TOOL_IDS, ...PLANNED_TOOL_IDS] as const;

export const ToolIdSchema = z.enum(TOOL_IDS, { error: "Unknown tool" });
export type ToolId = z.infer<typeof ToolIdSchema>;

export const TestSourceSchema = z.enum(["gemini", "template", "user"]);

export const TestCaseInputSchema = z.object({
  input: z.string().trim().min(1, "Enter the question to test").max(8000, "Keep the question under 8,000 characters"),
  mustCall: z.array(ToolIdSchema).max(10).default([]),
  mustNotCall: z.array(ToolIdSchema).max(10).default([]),
  mustContain: z.array(z.string().trim().min(1, "Phrases can't be empty").max(200, "Keep phrases under 200 characters")).max(20).default([]),
  useGrader: z.boolean().default(false),
  expectedBehavior: z.string().trim().min(1).max(2000).optional(),
  source: TestSourceSchema.default("user"),
}).strict().superRefine((value, ctx) => {
  for (const tool of value.mustCall) {
    if (value.mustNotCall.includes(tool)) {
      ctx.addIssue({ code: "custom", path: ["mustNotCall"], message: `"${tool}" can't be in both Must call and Must not call` });
    }
  }
});

/** Validated test case fields (defaults applied). */
export type TestCaseInput = z.infer<typeof TestCaseInputSchema>;
