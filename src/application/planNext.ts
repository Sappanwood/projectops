import { planMappingReference, planMaterializationState } from "../plan/planIdentity.js";
import { dependencyProblems } from "./dependencyReadiness.js";
import type { BacklogItem } from "../backlog/item.js";
import { projectArtifactRoots } from "../catalog/workspace.js";
import {
  loadWorkspace,
  ManifestParseError,
  WorkspaceNotFoundError,
} from "../catalog/workspaceStore.js";
import { isPlanId, PLAN_SCHEMA, type Plan } from "../plan/plan.js";
import { readPlan, PlanNotFoundError } from "../plan/planFs.js";
import { showBacklogItem } from "./backlogApi.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";

export type PlanNextTask = Pick<BacklogItem, "id" | "title" | "priority" | "status" | "project">;
export type PlanNextDiagnostic = { id: string; project?: string; code: string; message: string };
export type PlanNextSummary = {
  plan_id: string;
  ready: PlanNextTask[];
  in_progress: PlanNextTask[];
  blocked: Array<PlanNextTask & { reasons: PlanNextDiagnostic[] }>;
  next: PlanNextTask | null;
  diagnostics: PlanNextDiagnostic[];
};
type ProjectRequest = { workspaceDir: string; projectId: string };

export function getPlanNext(
  request: ProjectRequest & { planId: string },
): ApplicationResult<PlanNextSummary> {
  let workspace;
  try {
    workspace = loadWorkspace(request.workspaceDir);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError)
      return applicationFailure("WORKSPACE_NOT_FOUND", "Workspace not found.");
    return applicationFailure(
      "WORKSPACE_INVALID",
      error instanceof ManifestParseError
        ? "Workspace manifest is invalid."
        : "Workspace could not be read.",
    );
  }
  if (!Object.hasOwn(workspace.manifest.projects, request.projectId)) {
    return applicationFailure(
      "PROJECT_NOT_FOUND",
      `Project ${request.projectId} is not registered.`,
    );
  }
  if (workspace.manifest.artifact_layout.roots.plans !== PLAN_SCHEMA) {
    return applicationFailure("PLAN_INVALID", "Plan artifact type is invalid.");
  }
  if (!isPlanId(request.planId)) return applicationFailure("PLAN_INVALID", "Invalid Plan ID.");
  let plan;
  try {
    const root = projectArtifactRoots(
      workspace.root,
      request.projectId,
      workspace.manifest.artifact_layout,
    ).plans;
    plan = readPlan(root, request.planId);
    if (plan.id !== request.planId)
      return applicationFailure("PLAN_INVALID", "Plan ID does not match its file.");
  } catch (error) {
    if (error instanceof PlanNotFoundError)
      return applicationFailure("PLAN_NOT_FOUND", `Plan ${request.planId} was not found.`);
    return applicationFailure("PLAN_INVALID", `Plan ${request.planId} is invalid or unreadable.`);
  }
  return applicationSuccess(readPlanNext(request, plan));
}

export function readPlanNext(request: ProjectRequest, plan: Plan): PlanNextSummary {
  const summary: PlanNextSummary = {
    plan_id: plan.id,
    ready: [],
    in_progress: [],
    blocked: [],
    next: null,
    diagnostics: [],
  };
  if (!plan.materialization) {
    summary.diagnostics.push({
      id: plan.id,
      code: "PLAN_NOT_MATERIALIZED",
      message: "计划尚未物化，未开始执行。",
    });
    return summary;
  }
  if (planMaterializationState(plan) === "partial")
    summary.diagnostics.push({
      id: plan.id,
      code: "PLAN_PARTIALLY_MATERIALIZED",
      message: "计划部分物化；先恢复物化再执行。",
    });
  for (const draft of plan.items) {
    if (draft.item_type !== "task") continue;
    const value = plan.materialization.mapping[draft.key];
    if (!value) continue;
    const reference = planMappingReference(request.projectId, value)!;
    const id = reference.item;
    const loaded = readTask({ ...request, projectId: reference.project }, id);
    if (!loaded.ok) {
      summary.diagnostics.push(loaded.diagnostic);
      continue;
    }
    const item = loaded.item;
    if (item.item_type !== "task") {
      summary.diagnostics.push({ id, code: "ITEM_TYPE_MISMATCH", message: "映射目标不是 task。" });
      continue;
    }
    const task = {
      project: item.project,
      id: item.id,
      title: item.title,
      priority: item.priority,
      status: item.status,
    };
    if (item.status === "done") continue;
    if (item.status === "in_progress") {
      summary.in_progress.push(task);
      continue;
    }
    if (item.status !== "todo") {
      summary.diagnostics.push({
        id,
        code: "TASK_NOT_TODO",
        message: `任务状态为 ${item.status}，不作为待启动推荐。`,
      });
      continue;
    }
    const reasons = dependencyProblems(request.workspaceDir, item.project, item.depends_on);
    if (reasons.length) summary.blocked.push({ ...task, reasons });
    else summary.ready.push(task);
  }
  const byPriorityAndId = (a: PlanNextTask, b: PlanNextTask) =>
    a.priority.localeCompare(b.priority) ||
    `${a.project}:${a.id}`.localeCompare(`${b.project}:${b.id}`);
  summary.ready.sort(byPriorityAndId);
  summary.in_progress.sort(byPriorityAndId);
  summary.blocked.sort(byPriorityAndId);
  summary.diagnostics.sort((a, b) => a.id.localeCompare(b.id));
  summary.next = planMaterializationState(plan) === "complete" ? (summary.ready[0] ?? null) : null;
  return summary;
}

function readTask(
  request: ProjectRequest,
  id: string,
): { ok: true; item: BacklogItem } | { ok: false; diagnostic: PlanNextDiagnostic } {
  let code: string;
  try {
    const result = showBacklogItem({ ...request, itemId: id });
    if (result.ok && result.data.item.project === request.projectId)
      return { ok: true, item: result.data.item };
    code = result.ok ? "ITEM_PROJECT_MISMATCH" : result.error.code;
  } catch {
    code = "ITEM_UNAVAILABLE";
  }
  const reasons: Record<string, string> = {
    ITEM_NOT_FOUND: "条目缺失。",
    ITEM_INVALID: "条目损坏。",
    INVALID_ITEM_ID: "条目 ID 不属于当前项目或格式无效。",
    ITEM_PROJECT_MISMATCH: "条目不属于当前项目。",
    ITEM_ID_MISMATCH: "条目 ID 与文件不匹配。",
  };
  return {
    ok: false,
    diagnostic: {
      id,
      project: request.projectId,
      code,
      message: reasons[code] ?? "无法读取当前项目中的条目。",
    },
  };
}
