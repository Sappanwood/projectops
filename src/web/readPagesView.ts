export type ReadPage = "plans" | "reports" | "docs" | "retrospectives";
export type RetrospectiveFilters = { project: string; status: string; task: string };
export function isReadPage(view: string): view is ReadPage {
  return ["plans", "reports", "docs", "retrospectives"].includes(view);
}
