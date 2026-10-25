import { googleNews } from "./googleNews";
import { googleShopping } from "./googleShopping";
import { knowledgeSearch } from "./knowledgeSearch";
import { readWebpage } from "./readWebpage";
import { salesLookup } from "./salesLookup";
import { sendEmail } from "./sendEmail";
import type { Tool, ToolId } from "./types";

export const integrationTools: Record<ToolId, Tool> = {
  knowledge_search: knowledgeSearch,
  sales_lookup: salesLookup,
  google_shopping: googleShopping,
  google_news: googleNews,
  read_webpage: readWebpage,
  send_email: sendEmail,
};
