import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  parseTaskReference,
  taskReferenceKey,
  type TaskReference,
} from "../backlog/dependencyReference.js";
import type { DependencyEvidence } from "../execution/attempt.js";
import { context, ExecutionError, listAttempts } from "../execution/store.js";
import { parallelRoot, readParallelRun } from "../planRun/parallelRun.js";
import { sameTaskInput } from "../planRun/planRun.js";
import { readTaskReference } from "./backlogDependencies.js";
import { verificationChecksForSnapshot, verificationChecksPass } from "./verificationChecks.js";

export type { DependencyEvidence } from "../execution/attempt.js";
export type DependencyDiagnostic = { id: string; project?: string; code: string; message: string };

export function freezeDependency(
  workspaceDir: string,
  reference: TaskReference,
): DependencyEvidence {
  const key = taskReferenceKey(reference);
  const fail = (message: string): never => {
    throw new ExecutionError("EXECUTION_CONFLICT", `${key}: ${message}`);
  };
  const loaded = readTaskReference(workspaceDir, reference);
  if (!loaded.ok) throw new ExecutionError("EXECUTION_CONFLICT", loaded.error.message);
  const input = loaded.data.item;
  if (input.status !== "done") fail(`Dependency is ${input.status}, not done.`);
  try {
    const c = context(workspaceDir, reference.project);
    const latest = listAttempts(c.root, reference.project)
      .filter((a) => a.item_id === reference.item)
      .at(-1);
    const result: DependencyEvidence = {
      reference,
      input,
      basis: "done",
      attempt_id: null,
      snapshot_digest: null,
      landing_digest: null,
      verification_digest: null,
    };
    if (!latest) return result;
    const checks = verificationChecksForSnapshot(
      latest.verifications,
      latest.acceptance?.snapshot_digest,
    );
    if (
      latest.state !== "succeeded" ||
      latest.acceptance?.decision !== "accepted" ||
      !sameTaskInput(latest.input.item, input) ||
      !latest.snapshot ||
      latest.snapshot.digest !== latest.acceptance.snapshot_digest ||
      !checks.length ||
      !verificationChecksPass(c.root, checks)
    )
      fail("Current accepted attempt and durable passing evidence are required.");
    result.basis = "accepted";
    result.attempt_id = latest.id;
    result.snapshot_digest = latest.snapshot!.digest;
    result.verification_digest = createHash("sha256")
      .update(JSON.stringify({ acceptance: latest.acceptance, checks }))
      .digest("hex");
    if (latest.checkout) {
      const run = readParallelRun(parallelRoot(c.root), latest.checkout.run_id, reference.project);
      const node = run.nodes.find(
        (n) => n.item_id === reference.item && n.workspace?.nodeId === latest.checkout!.node_id,
      );
      const landing = node?.landings.at(-1);
      if (
        !node ||
        node.state !== "landed" ||
        node.attempt_ids.at(-1) !== latest.id ||
        !sameTaskInput(node.input, input) ||
        !landing ||
        landing.outcome !== "landed" ||
        !landing.candidateCommit ||
        landing.nodeCommit !== latest.snapshot!.head ||
        !landing.evidence.trim() ||
        JSON.stringify(JSON.parse(readFileSync(landing.evidenceFile, "utf8"))) !==
          JSON.stringify(landing)
      )
        fail("Current durable landed evidence is required.");
      const integrationTip = execFileSync(
        "git",
        ["rev-parse", "--verify", `${run.workspace.integrationRef}^{commit}`],
        { cwd: c.repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", landing!.candidateCommit!, integrationTip],
        { cwd: c.repo, stdio: "pipe" },
      );
      result.basis = "landed";
      result.landing_digest = createHash("sha256").update(JSON.stringify(landing)).digest("hex");
    }
    return result;
  } catch (error) {
    return fail(
      error instanceof ExecutionError
        ? error.message
        : "Dependency execution evidence is unavailable.",
    );
  }
}

export function validateFrozenDependency(workspaceDir: string, evidence: DependencyEvidence): void {
  const current = freezeDependency(workspaceDir, evidence.reference);
  if (
    !sameTaskInput(current.input, evidence.input) ||
    current.basis !== evidence.basis ||
    current.attempt_id !== evidence.attempt_id ||
    current.snapshot_digest !== evidence.snapshot_digest ||
    current.verification_digest !== evidence.verification_digest ||
    current.landing_digest !== evidence.landing_digest
  )
    throw new ExecutionError(
      "EXECUTION_CONFLICT",
      `${taskReferenceKey(evidence.reference)}: dependency input or frozen evidence changed.`,
    );
}

export function dependencyProblems(
  workspaceDir: string,
  project: string,
  values: string[],
): DependencyDiagnostic[] {
  const problems: DependencyDiagnostic[] = [];
  for (const value of values) {
    const reference = parseTaskReference(value, project);
    if (!reference) {
      problems.push({
        id: value,
        project,
        code: "ITEM_INVALID",
        message: `Invalid dependency: ${value}.`,
      });
      continue;
    }
    const loaded = readTaskReference(workspaceDir, reference);
    if (!loaded.ok) {
      problems.push({ id: value, project: reference.project, ...loaded.error });
      continue;
    }
    if (loaded.data.item.status !== "done") {
      problems.push({
        id: value,
        project: reference.project,
        code: "DEPENDENCY_NOT_DONE",
        message: `${taskReferenceKey(reference)}: dependency is ${loaded.data.item.status}.`,
      });
      continue;
    }
    try {
      freezeDependency(workspaceDir, reference);
    } catch (error) {
      problems.push({
        id: value,
        project: reference.project,
        code: "DEPENDENCY_EVIDENCE_INVALID",
        message: error instanceof Error ? error.message : "Dependency unavailable.",
      });
    }
  }
  return problems;
}

export function readPlanPrerequisites(
  request: { workspaceDir: string; projectId: string },
  plan: import("../plan/plan.js").Plan,
): { evidence: DependencyEvidence[]; diagnostics: DependencyDiagnostic[] } {
  const evidence: DependencyEvidence[] = [];
  const diagnostics: DependencyDiagnostic[] = [];
  if (!plan.materialization) return { evidence, diagnostics };
  const owned = new Set(
    Object.values(plan.materialization.mapping).map((id) => `${request.projectId}:${id}`),
  );
  const seen = new Set<string>();
  for (const draft of plan.items.filter((item) => item.item_type === "task")) {
    const reference = {
      project: request.projectId,
      item: plan.materialization.mapping[draft.key]!,
    };
    const loaded = readTaskReference(request.workspaceDir, reference);
    if (!loaded.ok) {
      diagnostics.push({ id: taskReferenceKey(reference), ...loaded.error });
      continue;
    }
    for (const value of loaded.data.item.depends_on) {
      const ref = parseTaskReference(value, request.projectId);
      if (!ref) {
        diagnostics.push({
          id: value,
          code: "ITEM_INVALID",
          message: `Invalid dependency: ${value}.`,
        });
        continue;
      }
      const key = taskReferenceKey(ref);
      if (owned.has(key) || seen.has(key)) continue;
      seen.add(key);
      try {
        evidence.push(freezeDependency(request.workspaceDir, ref));
      } catch (error) {
        diagnostics.push({
          id: key,
          project: ref.project,
          code: "DEPENDENCY_UNSATISFIED",
          message: error instanceof Error ? error.message : "Dependency unavailable.",
        });
      }
    }
  }
  return { evidence, diagnostics };
}
