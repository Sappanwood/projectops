import { createHash } from "node:crypto";
import { realpathSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isWithinWorkspace, projectArtifactRoots } from "../catalog/workspace.js";
import { loadWorkspace } from "../catalog/workspaceStore.js";
import { parsePlanDraft, PLAN_SCHEMA, type Plan } from "../plan/plan.js";
import { readPlan, planPath, updatePlan, PlanNotFoundError } from "../plan/planFs.js";
import { computeRevision, type BacklogItem } from "../backlog/item.js";
import { updateItemFile, rebuildIndex } from "../backlog/itemFs.js";
import { showBacklogItem } from "./backlogApi.js";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "./result.js";

import { listExecutions } from "./executionApi.js";

type PlanRequest = {workspaceDir: string; projectId: string; planId: string};
export type PlanRevisionRequest = PlanRequest & {draft: unknown; expectedRevision: string; confirm?: string};
export type PlanRevisionReceipt = {plan: Plan; revision: string; applied: boolean; confirmation_token: string; changes: {key: string; fields: string[]; item_id?: string}[]; affected_items: {id: string; revision: string}[]};
export function computePlanRevision(plan: Plan): string { return digest(plan); }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function context(request: PlanRequest): ApplicationResult<{plans: string; backlog: string; plan: Plan}> {
  try {
    const workspace = loadWorkspace(request.workspaceDir);
    if (!Object.hasOwn(workspace.manifest.projects, request.projectId)) return applicationFailure("PROJECT_NOT_FOUND", "Project is not registered.");
    if (workspace.manifest.artifact_layout.roots.plans !== PLAN_SCHEMA) return applicationFailure("PLAN_INVALID", "Invalid plan artifact type.");
    const roots = projectArtifactRoots(workspace.root, request.projectId, workspace.manifest.artifact_layout);
    const plan = readPlan(roots.plans, request.planId);
    if (plan.id !== request.planId) return applicationFailure("PLAN_INVALID", "Plan ID does not match its file.");
    if (!isWithinWorkspace(realpathSync(workspace.root), realpathSync(roots.plans)) || !isWithinWorkspace(realpathSync(roots.plans), realpathSync(planPath(roots.plans, plan.id)))) return applicationFailure("PLAN_INVALID", "Plan target resolves outside the declared workspace.");
    return applicationSuccess({...roots, plan});
  } catch (error) { return error instanceof PlanNotFoundError ? applicationFailure("PLAN_NOT_FOUND", "Plan was not found.") : applicationFailure("PLAN_INVALID", "Plan or workspace is invalid or unreadable."); }
}
export function showPlanRevision(request: PlanRequest): ApplicationResult<{plan: Plan; revision: string}> {
  const loaded = context(request); if (!loaded.ok) return loaded;
  return applicationSuccess({plan: loaded.data.plan, revision: computePlanRevision(loaded.data.plan)});
}
export function revisePlan(request: PlanRevisionRequest): ApplicationResult<PlanRevisionReceipt> {
  const loaded = context(request); if (!loaded.ok) return loaded;
  const {plan: before, plans, backlog} = loaded.data;
  const revision = computePlanRevision(before);
  if (request.expectedRevision !== revision) return applicationFailure("REVISION_MISMATCH", `Plan revision mismatch: current ${revision}. Reload and preview again.`);
  const draft = parsePlanDraft(request.draft);
  if (typeof draft === "string") return applicationFailure("PLAN_INVALID", draft);
  const plan: Plan = {...before, ...draft};
  const changes: PlanRevisionReceipt["changes"] = [];
  const pending: BacklogItem[] = [];
  const affected: BacklogItem[] = [];
  if (before.title !== plan.title || before.goal !== plan.goal) changes.push({key: "$plan", fields: ["title", "goal"].filter(key => before[key as "title" | "goal"] !== plan[key as "title" | "goal"])});
  if (JSON.stringify(before.items.map(item => item.key)) !== JSON.stringify(plan.items.map(item => item.key))) changes.push({key: "$plan", fields: ["item_order"]});
  const mapping = before.materialization?.mapping;
  if (mapping && (before.items.length !== draft.items.length || draft.items.some(item => !Object.hasOwn(mapping, item.key)))) return applicationFailure("PLAN_INVALID", "UNSUPPORTED_PLAN_CHANGE: Materialized plans cannot add, remove, or rename keys. Create a separate follow-up plan; existing mapping is preserved.");
  for (const key of new Set([...before.items.map(i=>i.key), ...draft.items.map(i=>i.key)])) {
    const old = before.items.find(i=>i.key===key); const next = draft.items.find(i=>i.key===key);
    const fields = old && next ? ["title","body","priority","item_type","parent","depends_on"].filter(field => JSON.stringify(old[field as keyof typeof old]) !== JSON.stringify(next[field as keyof typeof next])) : [old ? "removed" : "added"];
    if (!fields.length) continue;
    const id = mapping?.[key]; changes.push({key,fields,...(id ? {item_id:id}: {})});
    if (!id || !next || !old) continue;
    if (fields.includes("item_type") || fields.includes("parent")) return applicationFailure("PLAN_INVALID", `UNSUPPORTED_PLAN_CHANGE: ${key} type/parent changes require a separate follow-up plan.`);
    const found = showBacklogItem({...request,itemId:id}); if (!found.ok) return found;
    const item = found.data.item;
    const executions = listExecutions({...request,itemId:id});
    if (!executions.ok) return executions;
    if (executions.data.attempts.length) return applicationFailure("PLAN_INVALID", `TASK_PROTECTED: ${id} has execution history. Keep its plan input unchanged and create follow-up work.`);
    if (item.status !== "todo") return applicationFailure("PLAN_INVALID", `TASK_PROTECTED: ${id} is ${item.status}. Keep its plan input unchanged and create follow-up work.`);
    if (item.source !== `plan:${before.id}#${key}` || item.title !== old.title || item.body.trimEnd() !== old.body.trimEnd() || item.priority !== old.priority || JSON.stringify(item.depends_on) !== JSON.stringify(old.depends_on.map(k=>mapping![k]))) return applicationFailure("PLAN_INVALID", `TASK_DIVERGED: ${id} was edited independently. Reconcile its content before revising this plan.`);
    try {
      if (!isWithinWorkspace(realpathSync(loadWorkspace(request.workspaceDir).root), realpathSync(backlog)) || !isWithinWorkspace(realpathSync(backlog), realpathSync(path.join(backlog,"items",`${id}.md`))) || !isWithinWorkspace(realpathSync(backlog), realpathSync(path.join(backlog,"INDEX.md")))) return applicationFailure("PLAN_INVALID", "Backlog targets resolve outside their store.");
    } catch { return applicationFailure("PLAN_INVALID", "Backlog targets cannot be resolved."); }
    affected.push(item);
    const updated = {...item,title:next.title,body:next.body,priority:next.priority,depends_on:next.depends_on.map(k=>mapping![k]!),updated:new Date().toISOString().slice(0,10)};
    updated.revision=computeRevision(updated);pending.push(updated);
  }
  const affected_items = affected.map(item=>({id:item.id,revision:item.revision}));
  const confirmation_token = digest({revision,draft,affected_items});
  if (request.confirm !== undefined && request.confirm !== confirmation_token) return applicationFailure("REVISION_MISMATCH", "Preview changed. Preview again before confirming.");
  if (request.confirm !== undefined && changes.length) {
    if (before.status === "approved") plan.approval = {approved_at:new Date().toISOString(),review_note:`Explicitly confirmed revision ${confirmation_token}`};
    const files = [planPath(plans, plan.id), ...pending.map(item => path.join(backlog, "items", `${item.id}.md`)), ...(pending.length ? [path.join(backlog, "INDEX.md")] : [])];
    let backups: {file: string; content: string}[];
    try { backups = files.map(file => ({file, content: readFileSync(file, "utf8")})); }
    catch { return applicationFailure("PLAN_INVALID", "Cannot read revision targets; nothing was written."); }
    try {
      for (const item of pending) updateItemFile(backlog,item);
      if (pending.length) rebuildIndex(backlog);
      updatePlan(plans,plan);
    } catch {
      let restored = true;
      for (const backup of backups) {
        try { if (readFileSync(backup.file, "utf8") !== backup.content) writeFileSync(backup.file, backup.content); }
        catch { restored = false; }
      }
      return applicationFailure("PLAN_INVALID", restored ? "Revision write failed; original plan and tasks were restored. Resolve the filesystem error and preview again." : "Revision write failed and restoration was incomplete. Inspect the plan and affected task files before retrying.");
    }
  }
  return applicationSuccess({plan,revision:request.confirm===undefined?revision:computePlanRevision(plan),applied:request.confirm!==undefined,confirmation_token,changes,affected_items});
}
