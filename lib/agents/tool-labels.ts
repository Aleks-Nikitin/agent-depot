// Browser-safe names shared by setup and execution screens.
const labels: Record<string, string> = {
  github_list_issues: "Read GitHub issues",
  github_create_issue: "Create a reviewed GitHub issue",
  knowledge_search: "Search workspace knowledge",
  sales_lookup: "Explore sample sales",
  google_shopping: "Compare competitor prices",
  google_news: "Search recent news",
  read_webpage: "Read a public webpage",
  create_ticket: "Create a support ticket",
  send_email: "Email (removed)",
};
export const toolLabel = (id: string) => labels[id] ?? id;
