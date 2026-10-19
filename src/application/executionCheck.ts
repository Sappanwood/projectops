import { spawnSync } from "node:child_process";
import { executionResult, verifyExecution, type AttemptMutation } from "./executionApi.js";
import { activeStates } from "../execution/attempt.js";
import {
  context,
  evidence,
  executionRepo,
  ExecutionError,
  readAttempt,
} from "../execution/store.js";
import { captureSnapshot } from "../execution/snapshot.js";

export function checkExecution(q: AttemptMutation & { argv: string[]; timeoutMs?: number }) {
  return executionResult(() => {
    const timeout = q.timeoutMs ?? 600_000;
    if (
      !Array.isArray(q.argv) ||
      !q.argv[0]?.trim() ||
      q.argv.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
      !Number.isSafeInteger(timeout) ||
      timeout <= 0 ||
      timeout > 2_147_483_647
    )
      throw new ExecutionError("EXECUTION_INVALID", "Check requires argv and a positive timeout.");
    const c = context(q.workspaceDir, q.projectId);
    const attempt = readAttempt(c.root, q.attemptId, q.projectId);
    if (!q.expectedRevision || attempt.revision !== q.expectedRevision)
      throw new ExecutionError(
        "REVISION_MISMATCH",
        "Execution revision changed; reload before checking.",
      );
    if (activeStates.includes(attempt.state) || attempt.acceptance)
      throw new ExecutionError("EXECUTION_CONFLICT", "Check requires an ended, undecided attempt.");
    const cwd = executionRepo(c, attempt);
    const before = captureSnapshot(cwd);
    const started = new Date().toISOString();
    const result = spawnSync(q.argv[0]!, q.argv.slice(1), {
      cwd,
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024 * 1024,
    });
    const ended = new Date().toISOString();
    const after = executionResult(() => captureSnapshot(cwd));
    const snapshotChanged = !after.ok || before.digest !== after.data.digest;
    const error = result.error
      ? {
          code: (result.error as NodeJS.ErrnoException).code ?? "SPAWN_ERROR",
          message: result.error.message,
        }
      : null;
    const outcome = result.status === 0 && !error && !snapshotChanged ? "passed" : "failed";
    const body =
      JSON.stringify(
        {
          argv: q.argv,
          cwd,
          started_at: started,
          ended_at: ended,
          timeout_ms: timeout,
          exit_code: result.status,
          signal: result.signal,
          error,
          output_incomplete: error?.code === "ENOBUFS",
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          before_digest: before.digest,
          after_digest: after.ok ? after.data.digest : null,
          snapshot_error: after.ok ? null : after.error,
          snapshot_changed: snapshotChanged,
          outcome,
        },
        null,
        2,
      ) + "\n";
    const saved = after.ok
      ? verifyExecution({ ...q, command: JSON.stringify(q.argv), outcome, evidence: body })
      : after;
    if (!saved.ok) {
      const ref = evidence(c.root, attempt.id, body);
      throw new ExecutionError(
        saved.error.code as ExecutionError["code"],
        `${saved.error.message} Captured output retained at ${ref}; no verification was attached.`,
      );
    }
    return {
      ...saved.data,
      check: {
        outcome,
        exit_code: result.status,
        signal: result.signal,
        error,
        snapshot_changed: snapshotChanged,
        output_incomplete: error?.code === "ENOBUFS",
        evidence_ref: saved.data.attempt.verifications.at(-1)!.evidence_ref,
      },
    };
  });
}
