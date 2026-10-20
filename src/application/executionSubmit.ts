import { checkExecution } from "./executionCheck.js";
import {
  decideExecution,
  finishExecution,
  showExecution,
  verifyExecution,
  type AttemptMutation,
} from "./executionApi.js";
import { executionSummary } from "./executionSummary.js";

type Step =
  | { kind: "finish"; outcome: "succeeded" | "failed" | "stopped"; summary: string }
  | { kind: "check"; argv: string[]; timeout_ms?: number }
  | { kind: "verify"; command: string; outcome: "passed" | "failed"; evidence: string }
  | { kind: "accept"; note: string };

type Receipt = {
  step: number;
  kind: Step["kind"];
  revision: string;
  outcome: string;
  evidence_ref?: string;
};

export function parseSubmission(value: unknown): Step[] {
  const invalid = (): never => {
    throw new Error("Invalid submission steps.");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== "steps") ||
    !Array.isArray(input.steps) ||
    !input.steps.length
  )
    return invalid();
  const nonempty = (v: unknown): v is string => typeof v === "string" && !!v.trim();
  const steps = input.steps;
  return steps.map((raw: unknown, index: number) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const s = raw as Record<string, unknown>;
    const allowed =
      s.kind === "finish"
        ? ["kind", "outcome", "summary"]
        : s.kind === "check"
          ? ["kind", "argv", "timeout_ms"]
          : s.kind === "verify"
            ? ["kind", "command", "outcome", "evidence"]
            : s.kind === "accept"
              ? ["kind", "note"]
              : [];
    if (!allowed.length || Object.keys(s).some((key) => !allowed.includes(key))) return invalid();
    if (
      s.kind === "finish" &&
      (index !== 0 ||
        typeof s.outcome !== "string" ||
        !["succeeded", "failed", "stopped"].includes(s.outcome) ||
        !nonempty(s.summary))
    )
      return invalid();
    if (
      s.kind === "check" &&
      (!Array.isArray(s.argv) ||
        !nonempty(s.argv[0]) ||
        s.argv.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
        (s.timeout_ms !== undefined &&
          (!Number.isSafeInteger(s.timeout_ms) ||
            Number(s.timeout_ms) <= 0 ||
            Number(s.timeout_ms) > 2_147_483_647)))
    )
      return invalid();
    if (
      s.kind === "verify" &&
      (!nonempty(s.command) ||
        typeof s.outcome !== "string" ||
        !["passed", "failed"].includes(s.outcome) ||
        !nonempty(s.evidence))
    )
      return invalid();
    if (s.kind === "accept" && (index !== steps.length - 1 || !nonempty(s.note))) return invalid();
    return s as Step;
  });
}

export function submitExecution(
  q: AttemptMutation & {
    submission: unknown;
    fromStep?: number;
    accept?: boolean;
    view?: "summary" | "full";
  },
) {
  let steps: Step[];
  const start = q.fromStep ?? 0;
  try {
    steps = parseSubmission(q.submission);
    if (!Number.isSafeInteger(start) || start < 0 || start >= steps.length)
      throw new Error("from-step must identify an existing step (zero-based).");
    if (steps.slice(start).some((s) => s.kind === "accept") && !q.accept)
      throw new Error("An accept step requires explicit --accept authorization.");
  } catch (error) {
    return {
      ok: false as const,
      error: { code: "EXECUTION_INVALID", message: (error as Error).message },
    };
  }
  const initial = showExecution(q);
  if (!initial.ok) return initial;
  let detail = initial.data;
  const receipts: Receipt[] = [];
  const data = (next: number | null) => ({
    ...detail,
    ...(q.view === "summary" ? { view: "summary", attempt: executionSummary(detail.attempt) } : {}),
    receipts,
    next_step: next,
  });
  if (!q.expectedRevision || detail.attempt.revision !== q.expectedRevision)
    return {
      ok: false as const,
      error: {
        code: "REVISION_MISMATCH",
        message: "Execution revision changed; inspect the attempt before resuming.",
      },
      data: data(start),
    };
  for (let index = start; index < steps.length; index++) {
    const step = steps[index]!;
    const mutation = { ...q, expectedRevision: detail.attempt.revision };
    const result =
      step.kind === "finish"
        ? finishExecution({ ...mutation, ...step })
        : step.kind === "check"
          ? checkExecution({
              ...mutation,
              argv: step.argv,
              ...(step.timeout_ms === undefined ? {} : { timeoutMs: step.timeout_ms }),
            })
          : step.kind === "verify"
            ? verifyExecution({ ...mutation, ...step })
            : decideExecution({ ...mutation, decision: "accepted", note: step.note });
    if (!result.ok) {
      const current = showExecution(q);
      if (current.ok) detail = current.data;
      return { ...result, data: data(index) };
    }
    detail = result.data;
    const verification =
      step.kind === "check" || step.kind === "verify"
        ? detail.attempt.verifications.at(-1)!
        : undefined;
    receipts.push({
      step: index,
      kind: step.kind,
      revision: detail.attempt.revision,
      outcome: verification?.outcome ?? (step.kind === "finish" ? step.outcome : "accepted"),
      ...(verification ? { evidence_ref: verification.evidence_ref } : {}),
    });
    if (verification?.outcome === "failed")
      return {
        ok: false as const,
        error: {
          code: "EXECUTION_CONFLICT",
          message: `Step ${index} recorded failed verification; later steps were not run.`,
        },
        data: data(index),
      };
  }
  return { ok: true as const, data: data(null) };
}
