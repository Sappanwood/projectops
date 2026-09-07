import { parseTaskReference, taskReferenceKey } from "../backlog/dependencyReference.js";
import { materializedDependencies } from "./planDependencies.js";
import {
  freezeDependency,
  validateFrozenDependency,
  type DependencyEvidence,
} from "./dependencyReadiness.js";
import { showBacklogItem } from "./backlogApi.js";
import { executionResult } from "./executionApi.js";
import { verificationChecksForSnapshot, verificationChecksPass } from "./verificationChecks.js";
import { computePlanRevision, computePlanExecutionRevision } from "./planRevision.js";
import type { ApplicationResult } from "./result.js";
import { activeStates, type CodeSnapshot, type ExecutionAttempt } from "../execution/attempt.js";
import { ExecutionRuntime } from "../execution/runtime.js";
import { captureSnapshot } from "../execution/snapshot.js";
import { context, ExecutionError, listAttempts, readAttempt } from "../execution/store.js";
import { readPlan } from "../plan/planFs.js";
import {
  nextReadyNode,
  PLAN_RUN_SCHEMA,
  sameTaskInput,
  type PlanRun,
  type PlanRunNode,
  type PlanRunReuse,
} from "../planRun/planRun.js";
import {
  listStoredPlanRuns,
  newPlanRunId,
  planRunRoot,
  readPlanRun,
  savePlanRun,
} from "../planRun/store.js";
import { listStoredParallelRuns, parallelRoot } from "../planRun/parallelRun.js";

export type PlanRunQuery = { workspaceDir: string; projectId: string };
export type PlanRunDetailQuery = PlanRunQuery & { runId: string };
export type PlanRunMutation = PlanRunDetailQuery & { expectedRevision: string };
export type PlanRunDetail = { run: PlanRun; diagnostics: string[] };
type Context = ReturnType<typeof context>;
const detail = (run: PlanRun): PlanRunDetail => ({ run, diagnostics: run.diagnostics });
function unwrap<T>(result: ApplicationResult<T>): T {
  if (!result.ok) throw new ExecutionError("EXECUTION_CONFLICT", result.error.message);
  return result.data;
}
function task(q: PlanRunQuery, itemId: string) {
  return unwrap(showBacklogItem({ ...q, itemId })).item;
}

function acceptedAttempt(
  c: Context,
  attempts: ExecutionAttempt[],
  attemptId: string,
  input: PlanRunNode["input"],
  baseline?: CodeSnapshot,
): ExecutionAttempt {
  const attempt = readAttempt(c.root, attemptId, input.project);
  const latest = attempts.filter((entry) => entry.item_id === input.id).at(-1);
  const checks = verificationChecksForSnapshot(
    attempt.verifications,
    attempt.acceptance?.snapshot_digest,
  );
  if (
    attempt.item_id !== input.id ||
    latest?.id !== attempt.id ||
    attempt.state !== "succeeded" ||
    attempt.acceptance?.decision !== "accepted" ||
    !sameTaskInput(attempt.input.item, input) ||
    !attempt.snapshot ||
    attempt.snapshot.digest !== attempt.acceptance.snapshot_digest ||
    checks.length === 0 ||
    !verificationChecksPass(c.root, checks) ||
    (baseline !== undefined && baseline.digest !== attempt.acceptance.snapshot_digest)
  )
    throw new ExecutionError(
      "EXECUTION_CONFLICT",
      `Task ${input.id} requires a current accepted attempt, matching baseline and passing durable evidence.`,
    );
  return attempt;
}

export function createPlanRun(
  q: PlanRunQuery & {
    planId: string;
    expectedRevision: string;
    reuse?: PlanRunReuse[];
    instructions?: string;
    model?: PlanRun["model"];
  },
) {
  return executionResult(() => {
    const c = context(q.workspaceDir, q.projectId);
    if (q.instructions !== undefined && typeof q.instructions !== "string")
      throw new ExecutionError("EXECUTION_INVALID", "Run instructions must be text.");
    const plan = readPlan(c.plans, q.planId);
    const revision = computePlanRevision(plan);
    if (q.expectedRevision !== revision)
      throw new ExecutionError(
        "REVISION_MISMATCH",
        "Plan revision changed before creating its run.",
      );
    if (plan.status !== "approved" || !plan.materialization)
      throw new ExecutionError(
        "EXECUTION_CONFLICT",
        "Plan run requires an approved, materialized Plan.",
      );
    const root = planRunRoot(c.root);
    if (
      listStoredPlanRuns(root, q.projectId).some(
        (run) => !["completed", "stopped"].includes(run.state),
      ) ||
      listStoredParallelRuns(parallelRoot(c.root), q.projectId).some(
        (run) => !["completed", "stopped"].includes(run.state),
      )
    )
      throw new ExecutionError(
        "EXECUTION_CONFLICT",
        "This project already has an unfinished Plan run.",
      );
    const attempts = listAttempts(c.root, q.projectId);
    if (attempts.some((attempt) => activeStates.includes(attempt.state)))
      throw new ExecutionError(
        "EXECUTION_CONFLICT",
        "Existing active or unknown work must be resolved first.",
      );
    const baseline = captureSnapshot(c.repo);
    const mapping = plan.materialization.mapping;
    if (new Set(Object.values(mapping)).size !== Object.values(mapping).length)
      throw new ExecutionError("EXECUTION_INVALID", "Plan mapping contains duplicate task IDs.");
    const reuse = new Map((q.reuse ?? []).map((entry) => [entry.itemId, entry]));
    if (reuse.size !== (q.reuse ?? []).length)
      throw new ExecutionError("EXECUTION_INVALID", "Duplicate reuse task.");
    const reuseTask = (input: PlanRunNode["input"]) => {
      const choice = reuse.get(input.id);
      if (input.status !== "done" || !choice?.note.trim())
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          `Task ${input.id} needs explicit accepted-attempt reuse evidence and a human reuse note.`,
        );
      acceptedAttempt(c, attempts, choice.attemptId, input, baseline);
      reuse.delete(input.id);
      return choice;
    };
    const nodes: PlanRunNode[] = plan.items
      .filter((item) => item.item_type === "task")
      .map((draft) => {
        const input = task(q, mapping[draft.key]!);
        if (input.item_type !== "task" || input.source !== `plan:${plan.id}#${draft.key}`)
          throw new ExecutionError(
            "EXECUTION_INVALID",
            "Plan task mapping does not match its source.",
          );
        const expected = materializedDependencies(draft.depends_on, mapping);
        const identity = (value: string) =>
          taskReferenceKey(parseTaskReference(value, q.projectId)!);
        const dependencies = new Set(input.depends_on.map(identity));
        if (expected.some((id) => !dependencies.has(identity(id))))
          throw new ExecutionError(
            "EXECUTION_INVALID",
            "Materialized dependency graph is missing Plan dependencies.",
          );
        if (!["todo", "in_progress", "done"].includes(input.status))
          throw new ExecutionError(
            "EXECUTION_CONFLICT",
            `Task ${input.id} is blocked or cancelled.`,
          );
        const choice = input.status === "done" ? reuseTask(input) : undefined;
        const history = attempts
          .filter((attempt) => attempt.item_id === input.id)
          .map((attempt) => attempt.id);
        return {
          key: draft.key,
          item_id: input.id,
          input: structuredClone(input),
          depends_on: input.depends_on.map((value) => {
            const reference = parseTaskReference(value, q.projectId)!;
            return reference.project === q.projectId ? reference.item : value;
          }),
          state: choice ? "accepted" : "pending",
          attempt_ids: history,
          accepted_attempt_id: choice?.attemptId ?? null,
          reuse_note: choice?.note ?? null,
        };
      });
    if (!nodes.length)
      throw new ExecutionError("EXECUTION_CONFLICT", "Plan has no executable tasks.");
    const nodeIds = new Set(nodes.map((node) => node.item_id));
    const externalDependencies: PlanRun["external_dependencies"] = [];
    const externalIds = new Set<string>();
    const crossProjectDependencies: DependencyEvidence[] = [];
    for (const node of nodes)
      for (const dependency of node.depends_on) {
        if (nodeIds.has(dependency) || externalIds.has(dependency)) continue;
        const reference = parseTaskReference(dependency, q.projectId)!;
        if (reference.project !== q.projectId) {
          crossProjectDependencies.push(freezeDependency(q.workspaceDir, reference));
          externalIds.add(dependency);
          continue;
        }
        const input = task(q, dependency);
        if (input.item_type !== "task")
          throw new ExecutionError(
            "EXECUTION_INVALID",
            "Only task dependencies can participate in execution.",
          );
        const choice = reuseTask(input);
        externalDependencies.push({ input, attempt_id: choice.attemptId, note: choice.note });
        externalIds.add(dependency);
      }
    if (reuse.size)
      throw new ExecutionError(
        "EXECUTION_INVALID",
        "Reuse entries must name completed tasks or dependencies in this run.",
      );
    const reachable = new Set(externalIds);
    while (true) {
      const ready = nodes.filter(
        (node) => !reachable.has(node.item_id) && node.depends_on.every((id) => reachable.has(id)),
      );
      if (!ready.length) break;
      for (const node of ready) reachable.add(node.item_id);
    }
    if (nodes.some((node) => !reachable.has(node.item_id)))
      throw new ExecutionError("EXECUTION_INVALID", "Task dependency graph contains a cycle.");
    const at = new Date().toISOString();
    const run: PlanRun = {
      schema: PLAN_RUN_SCHEMA,
      id: newPlanRunId(),
      project_id: q.projectId,
      plan_id: plan.id,
      plan_revision: revision,
      plan_snapshot: structuredClone(plan),
      instructions: q.instructions ?? "",
      mapping: structuredClone(mapping),
      revision: "",
      created_at: at,
      updated_at: at,
      state: nodes.every((node) => node.state === "accepted") ? "completed" : "ready",
      capacity: 1,
      initial_baseline: baseline,
      baseline,
      nodes,
      external_dependencies: externalDependencies,
      cross_project_dependencies: crossProjectDependencies,
      controls: [],
      diagnostics: [],
    };
    if (q.model) run.model = structuredClone(q.model);
    return detail(savePlanRun(planRunRoot(c.root, true), run, true));
  });
}

export function listPlanRuns(q: PlanRunQuery & { planId?: string }) {
  return executionResult(() => {
    const c = context(q.workspaceDir, q.projectId);
    return {
      runs: listStoredPlanRuns(planRunRoot(c.root), q.projectId).filter(
        (run) => !q.planId || run.plan_id === q.planId,
      ),
    };
  });
}
export function showPlanRun(q: PlanRunDetailQuery) {
  return executionResult(() =>
    detail(
      readPlanRun(planRunRoot(context(q.workspaceDir, q.projectId).root), q.runId, q.projectId),
    ),
  );
}

export function validatePlanRunCompletion(
  q: PlanRunDetailQuery,
  baselineMode: "current" | "recorded" = "current",
) {
  return executionResult(() => {
    const c = context(q.workspaceDir, q.projectId);
    const root = planRunRoot(c.root);
    const run = readPlanRun(root, q.runId, q.projectId);
    const latest = listStoredPlanRuns(root, q.projectId).find(
      (entry) => entry.plan_id === run.plan_id,
    );
    if (run.state !== "completed" || latest?.id !== run.id)
      throw new ExecutionError(
        "EXECUTION_CONFLICT",
        "Completion requires the latest Plan run to be completed.",
      );
    inputsValid(q, c, run);
    const baseline = baselineMode === "current" ? captureSnapshot(c.repo) : run.baseline;
    if (baseline.digest !== run.baseline.digest)
      throw new ExecutionError(
        "EXECUTION_CONFLICT",
        "Repository baseline changed after Plan completion.",
      );
    const history = listAttempts(c.root, q.projectId);
    if (history.some((attempt) => activeStates.includes(attempt.state)))
      throw new ExecutionError(
        "EXECUTION_CONFLICT",
        "Active or unknown work prevents completed delivery.",
      );
    const attempts = run.nodes.map((node) => {
      if (
        node.state !== "accepted" ||
        !node.accepted_attempt_id ||
        node.accepted_attempt_id !== node.attempt_ids.at(-1) ||
        (node.input.status === "done" && !node.reuse_note?.trim())
      )
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          `Task ${node.item_id} lacks accepted completion or explicit reuse provenance.`,
        );
      return acceptedAttempt(c, history, node.accepted_attempt_id, node.input);
    });
    for (const dependency of run.external_dependencies) {
      if (!dependency.note.trim())
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          "Dependency reuse needs an inspection note.",
        );
      acceptedAttempt(c, history, dependency.attempt_id, dependency.input);
    }
    return { run, attempts, baseline };
  });
}

function inputsValid(q: PlanRunQuery, c: Context, run: PlanRun): void {
  for (const dependency of run.cross_project_dependencies ?? [])
    validateFrozenDependency(q.workspaceDir, dependency);
  if (computePlanExecutionRevision(readPlan(c.plans, run.plan_id)) !== run.plan_revision)
    throw new ExecutionError(
      "EXECUTION_CONFLICT",
      "Plan input revision changed; create a new run for revised scope.",
    );
  for (const node of run.nodes) {
    const current = task(q, node.item_id);
    if (
      !sameTaskInput(node.input, current) ||
      (node.attempt_ids.length === 0 && current.revision !== node.input.revision)
    )
      throw new ExecutionError("EXECUTION_CONFLICT", `Task input changed: ${node.item_id}.`);
    if (node.state === "accepted" && current.status !== "done")
      throw new ExecutionError(
        "EXECUTION_CONFLICT",
        `Accepted task status changed: ${node.item_id}.`,
      );
    if (["blocked", "cancelled"].includes(current.status))
      throw new ExecutionError("EXECUTION_CONFLICT", `Task ${node.item_id} is ${current.status}.`);
  }
  for (const entry of run.external_dependencies) {
    const current = task(q, entry.input.id);
    if (current.status !== "done" || !sameTaskInput(current, entry.input))
      throw new ExecutionError(
        "EXECUTION_CONFLICT",
        `Dependency input changed: ${entry.input.id}.`,
      );
  }
}

export class PlanRunRuntime {
  constructor(private execution: ExecutionRuntime) {}

  private mutate(
    q: PlanRunMutation,
    operation: (run: PlanRun, c: Context) => void,
  ): ApplicationResult<PlanRunDetail> {
    return executionResult(() => {
      const c = context(q.workspaceDir, q.projectId);
      const root = planRunRoot(c.root);
      const run = readPlanRun(root, q.runId, q.projectId);
      if (!q.expectedRevision || q.expectedRevision !== run.revision)
        throw new ExecutionError(
          "REVISION_MISMATCH",
          "Plan run revision changed; reload before controlling it.",
        );
      const before = JSON.stringify(run);
      operation(run, c);
      return detail(before === JSON.stringify(run) ? run : savePlanRun(root, run));
    });
  }

  private observe(run: PlanRun, c: Context): void {
    const attempts = listAttempts(c.root, run.project_id);
    const problems: string[] = [];
    for (const dependency of run.external_dependencies) {
      try {
        acceptedAttempt(c, attempts, dependency.attempt_id, dependency.input);
      } catch (error) {
        problems.push(
          error instanceof ExecutionError ? error.message : "Dependency evidence is unavailable.",
        );
      }
    }
    for (const node of run.nodes) {
      try {
        const attemptId = node.attempt_ids.at(-1);
        if (!attemptId) continue;
        const attempt = readAttempt(c.root, attemptId, run.project_id);
        if (attempt.item_id !== node.item_id)
          throw new ExecutionError("EXECUTION_INVALID", "Run attempt belongs to another task.");
        if (node.state === "accepted") {
          acceptedAttempt(c, attempts, attemptId, node.input);
          continue;
        }
        if (
          node.state === "pending" &&
          !activeStates.includes(attempt.state) &&
          attempt.acceptance?.decision !== "accepted"
        )
          continue;
        if (attempt.acceptance?.decision === "accepted") {
          const current = captureSnapshot(c.repo);
          acceptedAttempt(c, attempts, attemptId, node.input, current);
          node.state = "accepted";
          node.accepted_attempt_id = attemptId;
          run.baseline = current;
        } else if (attempt.state === "unknown") {
          node.state = "unknown";
          throw new ExecutionError(
            "EXECUTION_CONFLICT",
            `Attempt ${attemptId} is unknown; confirm prior work stopped before resuming.`,
          );
        } else if (["running", "stop_requested"].includes(attempt.state)) {
          node.state = "running";
        } else if (attempt.state === "succeeded" && attempt.acceptance === null) {
          node.state = "awaiting_acceptance";
        } else {
          node.state = "failed";
          throw new ExecutionError(
            "EXECUTION_CONFLICT",
            `Task ${node.item_id} ended without acceptance; inspect and explicitly resume.`,
          );
        }
      } catch (error) {
        problems.push(
          error instanceof ExecutionError
            ? error.message
            : `Task ${node.item_id} execution is unavailable.`,
        );
      }
    }
    if (problems.length) throw new ExecutionError("EXECUTION_CONFLICT", problems.join(" "));
  }

  advance(q: PlanRunMutation) {
    return this.mutate(q, (run, c) => {
      if (["completed", "stopped"].includes(run.state)) return;
      const paused = run.state === "paused";
      const problems: string[] = [];
      for (const inspect of [() => this.observe(run, c), () => inputsValid(q, c, run)]) {
        try {
          inspect();
        } catch (error) {
          problems.push(
            error instanceof ExecutionError
              ? error.message
              : "Plan run inputs or execution records are unavailable.",
          );
        }
      }
      if (problems.length) {
        run.state = "paused";
        run.diagnostics = problems;
        return;
      }
      try {
        if (paused) return;
        if (run.nodes.every((node) => node.state === "accepted")) {
          run.state = "completed";
          run.diagnostics = [];
          return;
        }
        if (run.nodes.some((node) => ["running", "awaiting_acceptance"].includes(node.state))) {
          run.state = "running";
          return;
        }
        if (captureSnapshot(c.repo).digest !== run.baseline.digest)
          throw new ExecutionError(
            "EXECUTION_CONFLICT",
            "Repository baseline changed; inspect it before resuming.",
          );
        const node = nextReadyNode(run);
        if (!node)
          throw new ExecutionError(
            "EXECUTION_CONFLICT",
            "No task is ready; dependencies require accepted evidence.",
          );
        const history = listAttempts(c.root, q.projectId).filter(
          (attempt) => attempt.item_id === node.item_id,
        );
        const prior = node.attempt_ids.at(-1) ?? history.at(-1)?.id;
        if (prior && !node.attempt_ids.includes(prior))
          throw new ExecutionError(
            "EXECUTION_CONFLICT",
            "Existing task history is not owned by this run; inspect it before creating a new run.",
          );
        const instructions = `Execute Plan ${run.plan_id} task ${node.key}.\n${node.input.body}\n\nRun instructions:\n${run.instructions}`;
        const result = unwrap(
          this.execution.start({
            ...q,
            model: run.model,
            itemId: node.item_id,
            expectedRevision: task(q, node.item_id).revision,
            instructions,
            ...(prior ? { retryOf: prior } : {}),
          }),
        );
        if (history.some((attempt) => attempt.id === result.attempt.id))
          throw new ExecutionError(
            "EXECUTION_CONFLICT",
            "Runner returned an existing attempt rather than starting this node.",
          );
        node.attempt_ids.push(result.attempt.id);
        node.state = "running";
        run.state = "running";
        run.diagnostics = [];
      } catch (error) {
        run.state = "paused";
        run.diagnostics = [
          error instanceof ExecutionError
            ? error.message
            : "Plan run could not inspect its current inputs or execution records.",
        ];
      }
    });
  }

  pause(q: PlanRunMutation & { note?: string }) {
    return this.mutate(q, (run) => {
      if (["completed", "stopped"].includes(run.state))
        throw new ExecutionError("EXECUTION_CONFLICT", "Ended run cannot be paused.");
      run.state = "paused";
      run.controls.push({
        action: "pause",
        note: q.note ?? "Paused by user.",
        at: new Date().toISOString(),
        baseline_digest: run.baseline.digest,
      });
    });
  }

  resume(q: PlanRunMutation & { note: string; baselineDigest?: string }) {
    return this.mutate(q, (run, c) => {
      if (run.state !== "paused" || !q.note?.trim())
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          "Resume requires a paused run and an inspection note.",
        );
      inputsValid(q, c, run);
      const attempts = listAttempts(c.root, q.projectId);
      if (attempts.some((attempt) => activeStates.includes(attempt.state)))
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          "Running, stopping or unknown work must settle before resume.",
        );
      const baseline = captureSnapshot(c.repo);
      for (const dependency of run.external_dependencies)
        acceptedAttempt(c, attempts, dependency.attempt_id, dependency.input);
      for (const node of run.nodes) {
        const latestId = node.attempt_ids.at(-1);
        if (!latestId) continue;
        const latest = readAttempt(c.root, latestId, q.projectId);
        if (latest.acceptance?.decision === "accepted") {
          acceptedAttempt(
            c,
            attempts,
            latestId,
            node.input,
            node.state === "accepted" ? undefined : baseline,
          );
          node.state = "accepted";
          node.accepted_attempt_id = latestId;
        } else
          node.state =
            latest.state === "succeeded" && !latest.acceptance ? "awaiting_acceptance" : "pending";
      }
      if (baseline.digest !== run.baseline.digest && q.baselineDigest !== baseline.digest)
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          "Repository baseline changed; supply its current baselineDigest after inspection.",
        );
      if (q.baselineDigest !== undefined && q.baselineDigest !== baseline.digest)
        throw new ExecutionError("REVISION_MISMATCH", "Inspected repository baseline changed.");
      run.baseline = baseline;
      run.state = run.nodes.every((node) => node.state === "accepted") ? "completed" : "ready";
      run.diagnostics = [];
      run.controls.push({
        action: "resume",
        note: q.note,
        at: new Date().toISOString(),
        baseline_digest: baseline.digest,
      });
    });
  }

  stopCurrent(q: PlanRunMutation & { note?: string }) {
    return this.mutate(q, (run, c) => {
      const active = run.nodes
        .flatMap((node) =>
          node.attempt_ids.at(-1)
            ? [readAttempt(c.root, node.attempt_ids.at(-1)!, q.projectId)]
            : [],
        )
        .find((attempt) => attempt.state === "running");
      if (!active)
        throw new ExecutionError("EXECUTION_CONFLICT", "Plan run has no running attempt to stop.");
      unwrap(
        this.execution.stop({ ...q, attemptId: active.id, expectedRevision: active.revision }),
      );
      run.state = "paused";
      run.controls.push({
        action: "stop",
        note: q.note ?? "Stop current task requested.",
        at: new Date().toISOString(),
        baseline_digest: run.baseline.digest,
      });
    });
  }

  closeStopped(q: PlanRunMutation & { note: string }) {
    return this.mutate(q, (run, c) => {
      if (["completed", "stopped"].includes(run.state) || !q.note?.trim())
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          "Ending a Plan scope requires an unfinished run and an inspection note.",
        );
      if (listAttempts(c.root, q.projectId).some((attempt) => activeStates.includes(attempt.state)))
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          "Active or unknown work must be confirmed stopped before ending the Plan scope.",
        );
      run.state = "stopped";
      run.controls.push({
        action: "close_stopped",
        note: q.note,
        at: new Date().toISOString(),
        baseline_digest: run.baseline.digest,
      });
    });
  }
}
