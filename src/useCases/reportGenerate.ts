// Application use case: derive delivery evidence from a materialized Plan and its Backlog items.

import { parseReport, type Report } from "../report/report.js";
import { writeReport } from "../report/reportFs.js";
import { isItemIdForPrefix } from "../backlog/item.js";
import { ItemNotFoundError, readItemFile } from "../backlog/itemFs.js";
import { loadStore, StoreNotFoundError, StoreParseError } from "../backlog/storeFs.js";
import { PLAN_SCHEMA, type Plan } from "../plan/plan.js";
import { PlanNotFoundError, PlanParseError, readPlan } from "../plan/planFs.js";
import { listPlanRuns, validatePlanRunCompletion } from '../application/planRunApi.js';
import { listParallelRuns, validateParallelRunCompletion } from '../application/parallelRunApi.js';

export type ReportGenerationInput = {
  projectId: string;
  plansRoot: string;
  planId: string;
  backlogRoot: string;
  reportId?: string;
  title?: string;
  createdAt?: string;
  verification?: string[];
  deviations?: string[];
  workarounds?: string[];
  repoDocs?: string[];
  body?: string;
  partialAcceptance?: string;
};

export type GeneratedReportInput = ReportGenerationInput & {
  workspaceRoot: string;
  reportsRoot: string;
};

export class ReportGenerationError extends Error {
  constructor(public readonly problem: string) {
    super(`Cannot generate report: ${problem}`);
  }
}

/**
 * Build a Report from one persisted, approved, materialized Plan without mutating any source artifact.
 */
export function generateReport(input: ReportGenerationInput): Report {
  const { projectId } = input;
  if (projectId.trim() === "") throw new ReportGenerationError("project id must be a non-empty string");
  const plan = readSourcePlan(input.plansRoot, input.planId);
  return deriveReport({ ...input, plan });
}

function deriveReport(input: ReportDerivationInput): Report {
  const { projectId, plan } = input;
  validateMaterializedPlan(plan);

  let store;
  try {
    store = loadStore(input.backlogRoot);
  } catch (error) {
    if (error instanceof StoreNotFoundError || error instanceof StoreParseError) {
      throw new ReportGenerationError(error.message);
    }
    throw error;
  }
  if (store.project_id !== projectId) {
    throw new ReportGenerationError(
      `backlog store belongs to project ${store.project_id}, not ${projectId}`,
    );
  }

  const mappedItems = plan.items.map((planItem) => {
    const id = plan.materialization!.mapping[planItem.key];
    if (typeof id !== "string") {
      throw new ReportGenerationError(`plan materialization mapping is missing ${planItem.key}`);
    }
    if (!isItemIdForPrefix(id, store.id_prefix)) {
      throw new ReportGenerationError(
        `backlog item ${id} for plan item ${planItem.key} does not belong to project ${projectId}`,
      );
    }
    try {
      const item = readItemFile(input.backlogRoot, id);
      if (item.id !== id) {
        throw new ReportGenerationError(`backlog item id mismatch: expected ${id}, got ${item.id}`);
      }
      if (item.project !== projectId) {
        throw new ReportGenerationError(
          `backlog item ${id} belongs to project ${item.project}, not ${projectId}`,
        );
      }
      return { planItem, item };
    } catch (error) {
      if (error instanceof ReportGenerationError) throw error;
      if (error instanceof ItemNotFoundError) {
        throw new ReportGenerationError(
          `backlog item ${id} for plan item ${planItem.key} was not found`,
        );
      }
      throw new ReportGenerationError(`cannot read backlog item ${id}: ${formatError(error)}`);
    }
  });
  const items = mappedItems.map(({ item }) => item);

  const unfinished = mappedItems.filter(({ planItem, item }) => planItem.item_type === "task" && item.status !== "done");
  const partialAcceptance = input.partialAcceptance?.trim();
  if (unfinished.length > 0 && (partialAcceptance === undefined || partialAcceptance === "")) {
    throw new ReportGenerationError(
      `unfinished backlog items: ${unfinished.map(({ item }) => `${item.id} (${item.status})`).join(", ")}; explicit partial acceptance with a non-empty explanation is required`,
    );
  }

  const report: Report = {
    schema: "report/Report@1",
    id: input.reportId ?? reportIdForPlan(plan),
    title: input.title ?? plan.title,
    project: projectId,
    created_at: input.createdAt ?? new Date().toISOString(),
    outcome: unfinished.length === 0 ? "completed" : "partial",
    plan: `project-ops:plans/${plan.id}.json`,
    backlog: items.map((item) => ({
      id: item.id,
      status: item.status,
      revision: item.revision,
      uri: `project-ops:backlog/items/${item.id}.md`,
    })),
    verification: [...(input.verification ?? [])],
    deviations: [
      ...(input.deviations ?? []),
      ...(unfinished.length === 0 || partialAcceptance === undefined ? [] : [partialAcceptance]),
    ],
    workarounds: [...(input.workarounds ?? [])],
    repo_docs: [...(input.repoDocs ?? [])],
    body: input.body ?? "",
  };
  const problem = parseReport(report);
  if (typeof problem === "string") throw new ReportGenerationError(problem);
  return report;
}

/**
 * Generate and persist a Report. All source validation occurs before the first write.
 */
export function writeGeneratedReport(input: GeneratedReportInput): Report {
  const report = generateReport(input);
  const runs = listPlanRuns({ workspaceDir: input.workspaceRoot, projectId: input.projectId, planId: input.planId });
  if (!runs.ok) throw new ReportGenerationError(`Plan run records are unavailable: ${runs.error.message}`);
  const latest = runs.data.runs[0];
  if (latest) {
    const validation = validatePlanRunCompletion({ workspaceDir: input.workspaceRoot, projectId: input.projectId, runId: latest.id });
    if (!validation.ok) {
      if (!input.partialAcceptance?.trim()) throw new ReportGenerationError(`Plan run is not verified complete: ${validation.error.message}`);
      report.outcome = 'partial';
      report.deviations.push(input.partialAcceptance.trim(), `Run ${latest.id}: ${validation.error.message}`);
    }
    report.verification.push(`Plan run: ${latest.id}; state: ${latest.state}`);
  }
  const parallel = listParallelRuns({ workspaceDir: input.workspaceRoot, projectId: input.projectId, planId: input.planId });
  if (!parallel.ok) throw new ReportGenerationError(`Parallel run records are unavailable: ${parallel.error.message}`);
  const latestParallel = parallel.data.runs.toSorted((a,b)=>b.created_at.localeCompare(a.created_at))[0];
  if (latestParallel) {
    const validation = validateParallelRunCompletion({ workspaceDir: input.workspaceRoot, projectId: input.projectId, runId: latestParallel.id });
    if (!validation.ok) {
      if (!input.partialAcceptance?.trim()) throw new ReportGenerationError(`Parallel run is not verified complete: ${validation.error.message}`);
      report.outcome = 'partial';
      report.deviations.push(input.partialAcceptance.trim(), `Parallel run ${latestParallel.id}: ${validation.error.message}`);
    }
    report.verification.push(`Parallel run: ${latestParallel.id}; integration ref: ${latestParallel.workspace.integrationRef}; head: ${latestParallel.integration_head}`);
  }
  writeReport(input.workspaceRoot, input.reportsRoot, report);
  return report;
}

type ReportDerivationInput = Omit<ReportGenerationInput, "plansRoot" | "planId"> & { plan: Plan };

function readSourcePlan(plansRoot: string, planId: string): Plan {
  let plan: Plan;
  try {
    plan = readPlan(plansRoot, planId);
  } catch (error) {
    if (error instanceof PlanNotFoundError || error instanceof PlanParseError) {
      throw new ReportGenerationError(error.message);
    }
    throw error;
  }
  if (plan.id !== planId) {
    throw new ReportGenerationError(`plan id mismatch: expected ${planId}, got ${plan.id}`);
  }
  return plan;
}

function validateMaterializedPlan(plan: Plan): void {
  if (plan.schema !== PLAN_SCHEMA) throw new ReportGenerationError("unexpected plan schema");
  if (plan.status !== "approved") {
    throw new ReportGenerationError("plan must be approved before Report generation");
  }
  if (plan.materialization === undefined) {
    throw new ReportGenerationError("plan must be materialized before Report generation");
  }

  const itemKeys = new Set(plan.items.map((item) => item.key));
  const mapping = plan.materialization.mapping;
  if (mapping === undefined || typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) {
    throw new ReportGenerationError("plan materialization mapping is missing");
  }
  for (const item of plan.items) {
    const id = mapping[item.key];
    if (typeof id !== "string" || id.trim() === "") {
      throw new ReportGenerationError(`plan materialization mapping is missing ${item.key}`);
    }
  }
  for (const key of Object.keys(mapping)) {
    if (!itemKeys.has(key)) {
      throw new ReportGenerationError(`plan materialization mapping has unknown key ${key}`);
    }
  }
  if (Object.keys(mapping).length !== plan.items.length) {
    throw new ReportGenerationError("plan materialization mapping must include every plan item");
  }
}

function reportIdForPlan(plan: Plan): string {
  return `report-${plan.id.replace(/^plan-/, "")}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
