import { z } from "zod";

export type ToolId =
  | "knowledge_search"
  | "sales_lookup"
  | "google_shopping"
  | "google_news"
  | "read_webpage"
  | "send_email";

export type Tool = {
  id: ToolId;
  description: string;
  input: z.ZodTypeAny;
  kind: "read" | "write";
  run: (args: unknown, context?: { signal: AbortSignal }) => Promise<unknown>;
};

export type KnowledgeDoc = { id: string; title: string; text: string };

export type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  unitsSold: number;
};
