import {
  createExecution,
  executionResult,
  finishExecution,
  listExecutions,
  mutateExecution,
  showExecution,
  type AttemptMutation,
  type CreateExecutionRequest,
  type ExecutionQuery,
  type AttemptDetail,
} from "../application/executionApi.js";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../application/result.js";
import { activeStates, type ExecutionAttempt, type ExecutionEvent } from "./attempt.js";
import { context, executionRepo, ExecutionError, saveProgress } from "./store.js";
import { isModelRef, type AvailableModel, type ModelRef } from "./models.js";
export type RunnerResult = {
  outcome: "succeeded" | "failed" | "stopped";
  summary: string;
};
export type RunnerContext = {
  recordModel?(model: ModelRef): void;
  repo: string;
  workspaceDir: string;
  emit(event: Omit<ExecutionEvent, "at"> & { at?: string }): void;
};
export type Runner = {
  listModels?(): Promise<AvailableModel[]>;
  resolveModel?(repo: string, selected?: ModelRef): Promise<ModelRef>;
  start(
    attempt: ExecutionAttempt,
    context: RunnerContext,
  ): {
    completion: Promise<RunnerResult>;
    stop(): void | Promise<void>;
    steer?(message: string): void | Promise<void>;
  };
};
export class ExecutionRuntime {
  private handles = new Map<
    string,
    {
      stop(): void | Promise<void>;
      steer?(message: string): void | Promise<void>;
    }
  >();
  constructor(private runner?: Runner) {}
  get available() {
    return this.runner !== undefined;
  }
  async listModels() {
    return {
      available: !!this.runner?.listModels,
      models: (await this.runner?.listModels?.()) ?? [],
    };
  }
  async resolveModel(
    workspaceDir: string,
    projectId: string,
    value: unknown,
  ): Promise<ModelRef | undefined> {
    if (value !== undefined && value !== null && !isModelRef(value))
      throw new Error("模型选择必须包含 provider 和 id。");
    if (!this.runner?.resolveModel) {
      if (value != null) throw new Error("当前执行器不支持模型选择。");
      return undefined;
    }
    const selected = value ?? undefined;
    if (
      selected &&
      !(await this.runner.listModels?.())?.some(
        (m) => m.provider === selected.provider && m.id === selected.id,
      )
    )
      throw new Error("所选模型不可用，请在本地 Pi 完成认证后刷新。");
    const c = context(workspaceDir, projectId);
    return this.runner.resolveModel(c.repo, selected);
  }
  start(q: CreateExecutionRequest): ApplicationResult<AttemptDetail> {
    return this.launch(q);
  }
  startManaged(
    q: CreateExecutionRequest,
    checkout: NonNullable<ExecutionAttempt["checkout"]>,
  ): ApplicationResult<AttemptDetail> {
    return this.launch(q, checkout);
  }
  private launch(
    q: CreateExecutionRequest,
    checkout?: ExecutionAttempt["checkout"],
  ): ApplicationResult<AttemptDetail> {
    const listed = listExecutions({ workspaceDir: q.workspaceDir, projectId: q.projectId });
    if (!listed.ok) return listed;
    const allActive = listed.data.attempts.filter((a) => activeStates.includes(a.state));
    const active = checkout ? allActive.find((a) => a.item_id === q.itemId) : allActive[0];
    if (
      checkout &&
      (allActive.some((a) => a.state === "unknown" || a.checkout?.run_id !== checkout.run_id) ||
        (!active && allActive.length >= 2))
    )
      return applicationFailure(
        "EXECUTION_CONFLICT",
        "Managed execution capacity or ownership is occupied.",
      );
    if (active) {
      if (
        active.state === "unknown" ||
        active.item_id !== q.itemId ||
        (checkout && active.checkout?.node_id !== checkout.node_id)
      )
        return applicationFailure(
          "EXECUTION_CONFLICT",
          "Existing work is awaiting manual confirmation.",
        );
      return applicationSuccess({ attempt: active, diagnostics: [] });
    }
    if (!this.runner)
      return applicationFailure(
        "RUNNER_UNAVAILABLE",
        "No runner is configured. Record externally executed work through the CLI.",
      );
    const resolved = executionResult(() => context(q.workspaceDir, q.projectId));
    if (!resolved.ok) return resolved;
    const target = executionResult(() =>
      executionRepo(resolved.data, checkout ? { checkout } : {}),
    );
    if (!target.ok) return target;
    const created = createExecution({ ...q, origin: "runtime" }, checkout);
    if (!created.ok) return created;
    const a = created.data.attempt;
    try {
      const handle = this.runner.start(structuredClone(a), {
        repo: target.data,
        workspaceDir: resolved.data.workspace,
        recordModel: (model) => {
          const current = showExecution({ ...q, attemptId: a.id });
          if (!current.ok || !isModelRef(model)) throw new Error("Invalid model record.");
          const saved = mutateExecution(
            { ...q, attemptId: a.id, expectedRevision: current.data.attempt.revision },
            (attempt, c) => {
              attempt.progress ??= { events: [] };
              attempt.progress.model = { ...model };
              saveProgress(c.root, a.id, attempt.revision, attempt.progress);
              return true;
            },
          );
          if (!saved.ok) throw new Error("Cannot record execution model.");
        },
        emit: (event) => this.append(q, a.id, event),
      });
      this.handles.set(a.id, handle);
      void handle.completion.then(
        (result) => this.complete(q, a.id, result),
        () => this.complete(q, a.id, { outcome: "failed", summary: "Runner failed." }),
      );
    } catch {
      this.complete(q, a.id, { outcome: "failed", summary: "Runner failed to start." });
      return showExecution({ ...q, attemptId: a.id });
    }
    return showExecution({ ...q, attemptId: a.id });
  }
  private append(
    q: ExecutionQuery,
    attemptId: string,
    event: Omit<ExecutionEvent, "at"> & { at?: string },
  ) {
    const current = showExecution({ ...q, attemptId });
    if (!current.ok) throw new ExecutionError("EXECUTION_INVALID", current.error.message);
    if (!["running", "stop_requested"].includes(current.data.attempt.state)) return;
    const saved = mutateExecution(
      { ...q, attemptId, expectedRevision: current.data.attempt.revision },
      (a, c) => {
        if (
          !["text", "tool", "status", "session"].includes(event.type) ||
          typeof event.text !== "string"
        )
          throw new ExecutionError("EXECUTION_INVALID", "Invalid runner event.");
        a.progress ??= { events: [] };
        const text = event.text.slice(0, 8000);
        const last = a.progress.events.at(-1);
        if (
          event.type === "text" &&
          last?.type === "text" &&
          last.text.length + text.length <= 8000
        )
          last.text += text;
        else a.progress.events.push({ type: event.type, text, at: new Date().toISOString() });
        a.progress.events = a.progress.events.slice(-200);
        if (event.type === "session") a.progress.session_id = text;
        saveProgress(c.root, a.id, a.revision, a.progress);
        return true;
      },
    );
    if (!saved.ok) throw new ExecutionError("EXECUTION_INVALID", saved.error.message);
  }
  async steer(q: AttemptMutation & { message: string }): Promise<ApplicationResult<AttemptDetail>> {
    const handle = this.handles.get(q.attemptId);
    const recorded = mutateExecution(q, (a) => {
      if (a.state !== "running" || !handle?.steer)
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          "Active runner does not support additional instructions.",
        );
      if (!q.message?.trim() || q.message.length > 8000)
        throw new ExecutionError(
          "EXECUTION_INVALID",
          "Instruction must contain 1–8000 characters.",
        );
      a.progress ??= { events: [] };
      a.progress.events.push({
        at: new Date().toISOString(),
        type: "status",
        text: `Instruction requested: ${q.message}`.slice(0, 8000),
      });
      a.progress.events = a.progress.events.slice(-200);
    });
    if (!recorded.ok) return recorded;
    try {
      await handle!.steer!(q.message);
    } catch {
      return applicationFailure(
        "EXECUTION_INVALID",
        "Additional instruction delivery failed; inspect progress before retrying.",
      );
    }
    return showExecution(q);
  }
  private complete(q: ExecutionQuery, attemptId: string, result: RunnerResult) {
    this.handles.delete(attemptId);
    const current = showExecution({ ...q, attemptId });
    if (!current.ok) return;
    if (current.data.attempt.state === "unknown") return;
    if (current.data.attempt.state === "stop_requested" && result.outcome === "succeeded") {
      mutateExecution({ ...q, attemptId, expectedRevision: current.data.attempt.revision }, (a) => {
        a.state = "unknown";
        a.summary = "Runner ended without confirming requested stop; inspect work manually.";
      });
      return;
    }
    const ended = finishExecution({
      ...q,
      attemptId,
      expectedRevision: current.data.attempt.revision,
      ...result,
    });
    if (!ended.ok)
      mutateExecution({ ...q, attemptId, expectedRevision: current.data.attempt.revision }, (a) => {
        a.state = "unknown";
        a.summary =
          "Runner ended but result recording failed; inspect the work before confirming interruption.";
      });
  }
  stop(q: AttemptMutation) {
    const result = mutateExecution(q, (a) => {
      if (a.state !== "running")
        throw new ExecutionError("EXECUTION_CONFLICT", "Attempt is not running.");
      a.state = "stop_requested";
    });
    if (!result.ok) return result;
    const handle = this.handles.get(q.attemptId);
    if (handle) {
      try {
        void Promise.resolve(handle.stop()).catch(() => {});
      } catch {}
    }
    return result;
  }
  recover(q: ExecutionQuery) {
    const listed = listExecutions(q);
    if (!listed.ok) return listed;
    for (const a of listed.data.attempts) {
      if (
        a.origin === "runtime" &&
        ["running", "stop_requested"].includes(a.state) &&
        !this.handles.has(a.id)
      )
        mutateExecution({ ...q, attemptId: a.id, expectedRevision: a.revision }, (entry) => {
          entry.state = "unknown";
          entry.summary =
            "Service cannot confirm whether previous work is still running. Inspect it before confirming interruption.";
        });
    }
    return listExecutions(q);
  }
  confirmInterrupted(
    q: AttemptMutation & {
      note: string;
    },
  ) {
    return mutateExecution(q, (a) => {
      if (a.state !== "unknown" || !q.note?.trim())
        throw new ExecutionError(
          "EXECUTION_CONFLICT",
          "Confirm an unknown attempt with an inspection note.",
        );
      a.state = "stopped";
      a.ended_at = new Date().toISOString();
      a.summary = q.note;
    });
  }
}
