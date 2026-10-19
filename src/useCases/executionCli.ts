import {
  createExecution,
  decideExecution,
  finishExecution,
  listExecutions,
  showExecution,
  verifyExecution,
} from "../application/executionApi.js";
import { ExecutionRuntime } from "../execution/runtime.js";
import type { CliIO } from "../io.js";
import { checkExecution } from "../application/executionCheck.js";
import { executionSummary } from "../application/executionSummary.js";
export type ExecutionCliOptions = {
  json?: boolean;
  view?: "summary" | "full";
  argv?: string[];
  timeoutMs?: number;
  expectedRevision?: string;
  instructions?: string;
  retryOf?: string;
  outcome?: string;
  summary?: string;
  command?: string;
  evidence?: string;
  decision?: string;
  note?: string;
  item?: string;
};
export function executionCli(
  action: string,
  projectId: string,
  target: string | undefined,
  options: ExecutionCliOptions,
  io: CliIO,
  cwd: string,
): number {
  const q = { workspaceDir: cwd, projectId };
  const mutation = {
    ...q,
    attemptId: target ?? "",
    expectedRevision: options.expectedRevision ?? "",
  };
  const checked =
    action === "check"
      ? checkExecution({
          ...mutation,
          argv: options.argv ?? [],
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        })
      : undefined;
  const result =
    checked ??
    (action === "list"
      ? listExecutions({ ...q, ...(options.item ? { itemId: options.item } : {}) })
      : action === "show"
        ? showExecution({ ...q, attemptId: target ?? "" })
        : action === "create"
          ? createExecution({
              ...q,
              itemId: target ?? "",
              ...(options.expectedRevision ? { expectedRevision: options.expectedRevision } : {}),
              ...(options.instructions ? { instructions: options.instructions } : {}),
              ...(options.retryOf ? { retryOf: options.retryOf } : {}),
            })
          : action === "finish"
            ? finishExecution({
                ...mutation,
                outcome: options.outcome as "succeeded" | "failed" | "stopped",
                summary: options.summary ?? "",
              })
            : action === "verify"
              ? verifyExecution({
                  ...mutation,
                  command: options.command ?? "",
                  outcome: options.outcome as "passed" | "failed",
                  evidence: options.evidence ?? "",
                })
              : action === "accept" || action === "rework"
                ? decideExecution({
                    ...mutation,
                    decision: action === "accept" ? "accepted" : "rework",
                    note: options.note ?? "",
                  })
                : action === "confirm-interrupted"
                  ? new ExecutionRuntime().confirmInterrupted({
                      ...mutation,
                      note: options.note ?? "",
                    })
                  : action === "recover"
                    ? new ExecutionRuntime().recover(q)
                    : {
                        ok: false as const,
                        error: {
                          code: "EXECUTION_INVALID",
                          message: "Unknown execution action.",
                        },
                      });
  const output =
    result.ok && options.view === "summary"
      ? {
          ok: true as const,
          data: {
            ...result.data,
            view: "summary",
            ...("attempt" in result.data ? { attempt: executionSummary(result.data.attempt) } : {}),
            ...("attempts" in result.data
              ? { attempts: result.data.attempts.map(executionSummary) }
              : {}),
          },
        }
      : result;
  if (options.json) io.stdout(JSON.stringify(output));
  else if (output.ok) io.stdout(JSON.stringify(output.data, null, 2));
  else io.stderr(output.error.message);
  return result.ok && (!checked?.ok || checked.data.check.outcome === "passed") ? 0 : 1;
}
