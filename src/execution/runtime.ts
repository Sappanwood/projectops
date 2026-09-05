import { createExecution, finishExecution, listExecutions, mutateExecution, showExecution, type AttemptMutation, type CreateExecutionRequest, type ExecutionQuery, type AttemptDetail } from '../application/executionApi.js';
import { applicationFailure, applicationSuccess, type ApplicationResult } from '../application/result.js';
import { activeStates, type ExecutionAttempt } from './attempt.js';
import { ExecutionError } from './store.js';
export type RunnerResult = {
    outcome: 'succeeded' | 'failed' | 'stopped';
    summary: string;
};
export type Runner = {
    start(attempt: ExecutionAttempt): {
        completion: Promise<RunnerResult>;
        stop(): void | Promise<void>;
    };
};
export class ExecutionRuntime {
    private handles = new Map<string, {
        stop(): void | Promise<void>;
    }>();
    constructor(private runner?: Runner) { }
    get available() { return this.runner !== undefined; }
    start(q: CreateExecutionRequest): ApplicationResult<AttemptDetail> {
        const listed = listExecutions(q);
        if (!listed.ok)
            return listed;
        const active = listed.data.attempts.find(a => activeStates.includes(a.state));
        if (active) {
            if (active.state === 'unknown')
                return applicationFailure('EXECUTION_CONFLICT', 'Existing work is awaiting manual confirmation.');
            return applicationSuccess({ attempt: active, diagnostics: [] });
        }
        if (!this.runner)
            return applicationFailure('RUNNER_UNAVAILABLE', 'No runner is configured. Record externally executed work through the CLI.');
        const created = createExecution({ ...q, origin: 'runtime' });
        if (!created.ok)
            return created;
        const a = created.data.attempt;
        try {
            const handle = this.runner.start(structuredClone(a));
            this.handles.set(a.id, handle);
            void handle.completion.then(result => this.complete(q, a.id, result), () => this.complete(q, a.id, { outcome: 'failed', summary: 'Runner failed.' }));
        }
        catch {
            this.complete(q, a.id, { outcome: 'failed', summary: 'Runner failed to start.' });
            return showExecution({ ...q, attemptId: a.id });
        }
        return created;
    }
    private complete(q: ExecutionQuery, attemptId: string, result: RunnerResult) {
        this.handles.delete(attemptId);
        const current = showExecution({ ...q, attemptId });
        if (!current.ok)
            return;
        if (current.data.attempt.state === 'unknown')
            return;
        if (current.data.attempt.state === 'stop_requested' && result.outcome === 'succeeded') {
            mutateExecution({ ...q, attemptId, expectedRevision: current.data.attempt.revision }, a => { a.state = 'unknown'; a.summary = 'Runner ended without confirming requested stop; inspect work manually.'; });
            return;
        }
        const ended = finishExecution({ ...q, attemptId, expectedRevision: current.data.attempt.revision, ...result });
        if (!ended.ok)
            mutateExecution({ ...q, attemptId, expectedRevision: current.data.attempt.revision }, a => { a.state = 'unknown'; a.summary = 'Runner ended but result recording failed; inspect the work before confirming interruption.'; });
    }
    stop(q: AttemptMutation) {
        const result = mutateExecution(q, a => { if (a.state !== 'running')
            throw new ExecutionError('EXECUTION_CONFLICT', 'Attempt is not running.'); a.state = 'stop_requested'; });
        if (!result.ok)
            return result;
        const handle = this.handles.get(q.attemptId);
        if (handle) {
            try {
                void Promise.resolve(handle.stop()).catch(() => { });
            }
            catch { }
        }
        return result;
    }
    recover(q: ExecutionQuery) {
        const listed = listExecutions(q);
        if (!listed.ok)
            return listed;
        for (const a of listed.data.attempts) {
            if (a.origin === 'runtime' && ['running', 'stop_requested'].includes(a.state) && !this.handles.has(a.id))
                mutateExecution({ ...q, attemptId: a.id, expectedRevision: a.revision }, entry => { entry.state = 'unknown'; entry.summary = 'Service cannot confirm whether previous work is still running. Inspect it before confirming interruption.'; });
        }
        return listExecutions(q);
    }
    confirmInterrupted(q: AttemptMutation & {
        note: string;
    }) {
        return mutateExecution(q, a => { if (a.state !== 'unknown' || !q.note?.trim())
            throw new ExecutionError('EXECUTION_CONFLICT', 'Confirm an unknown attempt with an inspection note.'); a.state = 'stopped'; a.ended_at = new Date().toISOString(); a.summary = q.note; });
    }
}
