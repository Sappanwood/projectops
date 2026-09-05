import { computePlanRevision } from './planRevision.js';
import { readPlan } from '../plan/planFs.js';
import { showBacklogItem } from './backlogApi.js';
import { applicationFailure, applicationSuccess, type ApplicationResult } from './result.js';
import { activeStates, EXECUTION_SCHEMA, type ExecutionAttempt } from '../execution/attempt.js';
import { context, evidence, evidenceDigest, evidenceReadable, ExecutionError, id, listAttempts, readAttempt, saveAttempt, validateAcceptanceTargets } from '../execution/store.js';
import { captureSnapshot } from '../execution/snapshot.js';
import { computeRevision } from '../backlog/item.js';
import { rebuildIndex, updateItemFile } from '../backlog/itemFs.js';
export type ExecutionQuery = {
    workspaceDir: string;
    projectId: string;
    itemId?: string;
};
export type AttemptQuery = ExecutionQuery & {
    attemptId: string;
};
export type AttemptMutation = AttemptQuery & {
    expectedRevision: string;
};
export type CreateExecutionRequest = ExecutionQuery & {
    itemId: string;
    instructions?: string;
    retryOf?: string;
    expectedRevision?: string;
    origin?: 'external' | 'runtime';
};
export type AttemptDetail = {
    attempt: ExecutionAttempt;
    diagnostics: string[];
};
export function executionResult<T>(f: () => T): ApplicationResult<T> { try {
    return applicationSuccess(f());
}
catch (e) {
    return e instanceof ExecutionError ? applicationFailure(e.code, e.message) : applicationFailure('EXECUTION_INVALID', 'Execution data or workspace is unavailable.');
} }
function detail(root: string, attempt: ExecutionAttempt): AttemptDetail { return { attempt, diagnostics: attempt.verifications.filter(v => !evidenceReadable(root, v.evidence_ref, v.evidence_digest)).map(v => `Evidence unavailable: ${v.evidence_ref}`) }; }
export function listExecutions(q: ExecutionQuery) { return executionResult(() => { const c = context(q.workspaceDir, q.projectId); return { attempts: listAttempts(c.root, q.projectId).filter(a => !q.itemId || a.item_id === q.itemId) }; }); }
export function showExecution(q: AttemptQuery) { return executionResult(() => { const c = context(q.workspaceDir, q.projectId); const a = readAttempt(c.root, q.attemptId, q.projectId); if (q.itemId && a.item_id !== q.itemId)
    throw new ExecutionError('EXECUTION_NOT_FOUND', 'Attempt does not belong to this task.'); return detail(c.root, a); }); }
export function createExecution(q: CreateExecutionRequest) {
    return executionResult(() => {
        const c = context(q.workspaceDir, q.projectId);
        const shown = showBacklogItem({ ...q, itemId: q.itemId });
        if (!shown.ok)
            throw new ExecutionError('EXECUTION_INVALID', shown.error.message);
        const item = shown.data.item;
        if (q.expectedRevision !== undefined && q.expectedRevision !== item.revision)
            throw new ExecutionError('REVISION_MISMATCH', 'Task revision changed; reload before starting.');
        let plan: ExecutionAttempt['input']['plan'] = null;
        const planMatch = /^plan:(plan-[a-z0-9-]+)#(.+)$/.exec(item.source);
        if (planMatch) {
            const snapshot = readPlan(c.plans, planMatch[1]!);
            plan = { ref: `project-ops:plans/${planMatch[1]}.json`, revision: computePlanRevision(snapshot), snapshot };
        }
        const attempts = listAttempts(c.root, q.projectId).filter(a => a.item_id === q.itemId);
        const active = attempts.find(a => activeStates.includes(a.state));
        if (active)
            throw new ExecutionError('EXECUTION_CONFLICT', `Task has an active attempt: ${active.id}.`);
        if (item.status === 'done' || item.status === 'cancelled')
            throw new ExecutionError('EXECUTION_CONFLICT', 'Completed or cancelled task cannot start work.');
        const previous = q.retryOf ? readAttempt(c.root, q.retryOf, q.projectId) : undefined;
        if (previous && (previous.item_id !== q.itemId || activeStates.includes(previous.state) || previous.acceptance?.decision === 'accepted'))
            throw new ExecutionError('EXECUTION_CONFLICT', 'Retry requires an ended, unaccepted attempt of this task.');
        if (attempts.length && !previous)
            throw new ExecutionError('EXECUTION_CONFLICT', 'Existing history requires an explicit retryOf attempt.');
        if (previous && attempts.some(a => a.retry_of === previous.id))
            throw new ExecutionError('EXECUTION_CONFLICT', 'This attempt already has a retry.');
        const attempt: ExecutionAttempt = { schema: EXECUTION_SCHEMA, id: id(), execution_id: previous?.execution_id ?? id(), retry_of: previous?.id ?? null, project_id: q.projectId, item_id: q.itemId, task_ref: `project-ops:backlog/items/${q.itemId}.md`, revision: '', origin: q.origin ?? 'external', input: { item: structuredClone(item), instructions: q.instructions ?? '', plan }, started_at: new Date().toISOString(), ended_at: null, state: 'running', summary: '', snapshot: null, verifications: [], acceptance: null };
        return detail(c.root, saveAttempt(c.root, attempt, true));
    });
}
export function mutateExecution(q: AttemptMutation, f: (a: ExecutionAttempt, c: ReturnType<typeof context>) => void | true) {
    return executionResult(() => {
        const c = context(q.workspaceDir, q.projectId);
        const a = readAttempt(c.root, q.attemptId, q.projectId);
        if (q.itemId && q.itemId !== a.item_id)
            throw new ExecutionError('EXECUTION_NOT_FOUND', 'Attempt does not belong to this task.');
        if (!q.expectedRevision || a.revision !== q.expectedRevision)
            throw new ExecutionError('REVISION_MISMATCH', 'Execution revision changed; reload the attempt.');
        const saved = f(a, c);
        return detail(c.root, saved === true ? a : saveAttempt(c.root, a));
    });
}
export function finishExecution(q: AttemptMutation & {
    outcome: 'succeeded' | 'failed' | 'stopped';
    summary: string;
}) {
    return mutateExecution(q, (a, c) => {
        if (!['running', 'stop_requested'].includes(a.state) || !['succeeded', 'failed', 'stopped'].includes(q.outcome))
            throw new ExecutionError('EXECUTION_CONFLICT', 'Attempt cannot end in this state.');
        if (a.state === 'stop_requested' && q.outcome === 'succeeded')
            throw new ExecutionError('EXECUTION_CONFLICT', 'Stop has not been confirmed.');
        a.state = q.outcome;
        a.ended_at = new Date().toISOString();
        a.summary = q.summary;
        a.snapshot = captureSnapshot(c.repo);
    });
}
export function verifyExecution(q: AttemptMutation & {
    command: string;
    outcome: 'passed' | 'failed';
    evidence: string;
}) {
    return mutateExecution(q, (a, c) => {
        if (activeStates.includes(a.state) || a.acceptance || !q.command?.trim() || !q.evidence?.trim() || !['passed', 'failed'].includes(q.outcome))
            throw new ExecutionError('EXECUTION_INVALID', 'Verification requires an ended, undecided attempt, command and durable evidence.');
        const snapshot = captureSnapshot(c.repo);
        a.snapshot = snapshot;
        a.verifications.push({ command: q.command, outcome: q.outcome, at: new Date().toISOString(), snapshot, evidence_ref: evidence(c.root, a.id, q.evidence), evidence_digest: evidenceDigest(q.evidence) });
    });
}
export function decideExecution(q: AttemptMutation & {
    decision: 'accepted' | 'rework';
    note: string;
}) {
    return mutateExecution(q, (a, c) => {
        if (activeStates.includes(a.state) || !['accepted', 'rework'].includes(q.decision))
            throw new ExecutionError('EXECUTION_CONFLICT', 'Only ended attempts can be reviewed.');
        if (a.acceptance)
            throw new ExecutionError('EXECUTION_CONFLICT', 'Attempt already has an acceptance decision.');
        const shown = showBacklogItem({ ...q, itemId: a.item_id });
        if (!shown.ok)
            throw new ExecutionError('EXECUTION_INVALID', shown.error.message);
        if (q.decision === 'accepted') {
            validateAcceptanceTargets(c, a.item_id);
            if (listAttempts(c.root, q.projectId).some(other => other.retry_of === a.id || (other.item_id === a.item_id && other.id !== a.id && activeStates.includes(other.state)))) throw new ExecutionError('EXECUTION_CONFLICT', 'This attempt has been superseded by later work. Review its successor instead.');
            const v = a.verifications.at(-1);
            const currentChecks = new Map(a.verifications.filter(x => x.snapshot.digest === v?.snapshot.digest).map(x => [x.command, x]));
            if ([...currentChecks.values()].some(x => x.outcome !== 'passed' || !evidenceReadable(c.root, x.evidence_ref, x.evidence_digest)))
                throw new ExecutionError('EXECUTION_CONFLICT', 'All current verification commands must pass with readable evidence.');
            if (a.state !== 'succeeded' || !v || v.outcome !== 'passed' || !evidenceReadable(c.root, v.evidence_ref, v.evidence_digest))
                throw new ExecutionError('EXECUTION_CONFLICT', 'Acceptance requires successful execution and readable passing evidence.');
            if (captureSnapshot(c.repo).digest !== v.snapshot.digest)
                throw new ExecutionError('EXECUTION_CONFLICT', 'Code changed since verification; verify again.');
            if (shown.data.item.revision !== a.input.item.revision)
                throw new ExecutionError('EXECUTION_CONFLICT', 'Task input changed; create a new attempt for the current task.');
            const item = { ...shown.data.item, status: 'done' as const, fixed_at: new Date().toISOString().slice(0, 10), updated: new Date().toISOString().slice(0, 10), revision: '' };
            item.revision = computeRevision(item);
            a.acceptance = { decision: q.decision, note: q.note ?? '', at: new Date().toISOString(), snapshot_digest: a.snapshot?.digest ?? null };
            saveAttempt(c.root, a);
            let itemWritten = false;
            try {
                updateItemFile(c.backlog, item);
                itemWritten = true;
                rebuildIndex(c.backlog);
            }
            catch (error) {
                const failures: unknown[] = [];
                a.acceptance = null;
                try { saveAttempt(c.root, a); } catch (failure) { failures.push(failure); }
                if (itemWritten) {
                    try { updateItemFile(c.backlog, shown.data.item); } catch (failure) { failures.push(failure); }
                    try { rebuildIndex(c.backlog); } catch (failure) { failures.push(failure); }
                }
                if (failures.length) throw new ExecutionError('EXECUTION_INVALID', 'Acceptance write failed and rollback was incomplete; inspect the attempt and task before retrying.');
                throw error;
            }
            return true;
        }
        a.acceptance = { decision: q.decision, note: q.note ?? '', at: new Date().toISOString(), snapshot_digest: a.snapshot?.digest ?? null };
    });
}
