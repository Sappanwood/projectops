import type { Report } from "../report/report.js";
import type { PlanNextSummary } from "./planNext.js";
import type { ItemStatus } from "../backlog/item.js";
import type { Plan, PlanItemType } from "../plan/plan.js";
import { showBacklogItem } from "./backlogApi.js";

export type PlanExecution = {
  materialized: boolean;
  counts: Record<ItemStatus | "total" | "unreadable", number>;
  completion_percent: number | null;
  items: Array<{
    key: string;
    id: string;
    title: string;
    item_type: PlanItemType;
    status: ItemStatus | "unreadable";
    diagnostic?: { code: string; message: string };
  }>;
};

export type WorkbenchPlan = Plan & { revision: string; execution: PlanExecution; next_tasks: PlanNextSummary; delivery_reports: Array<Pick<Report, "id" | "title" | "outcome" | "created_at">> };

export function readPlanExecution(
  request: { workspaceDir: string; projectId: string },
  plan: Plan,
): PlanExecution {
  const counts = { total: 0, todo: 0, in_progress: 0, done: 0, blocked: 0, cancelled: 0, unreadable: 0 };
  if (!plan.materialization) return { materialized: false, counts, completion_percent: null, items: [] };
  const mapping = plan.materialization.mapping;
  const items = plan.items.map((draft): PlanExecution["items"][number] => {
    const id = mapping[draft.key]!;
    let row: PlanExecution["items"][number] = {
      key: draft.key, id, title: draft.title, item_type: draft.item_type, status: "unreadable",
    };
    try {
      const result = showBacklogItem({ ...request, itemId: id });
      if (result.ok && result.data.item.project === request.projectId && result.data.item.item_type === draft.item_type) {
        row = { ...row, title: result.data.item.title, status: result.data.item.status };
      } else {
        row.diagnostic = {
          code: result.ok ? "ITEM_MISMATCH" : result.error.code,
          message: `无法读取 ${id}：${result.ok ? "项目或条目类型不匹配" : result.error.code === "ITEM_NOT_FOUND" ? "条目缺失" : "条目或 Backlog store 无效"}。`,
        };
      }
    } catch {
      row.diagnostic = { code: "ITEM_UNAVAILABLE", message: `无法读取 ${id}：读取失败。` };
    }
    if (draft.item_type === "task") {
      counts.total += 1;
      counts[row.status] += 1;
    }
    return row;
  });
  return {
    materialized: true, counts, items,
    completion_percent: counts.total === 0 ? null : Math.floor(counts.done / counts.total * 100),
  };
}
