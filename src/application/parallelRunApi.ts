import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { showBacklogItem, updateBacklogItemStatus } from './backlogApi.js';
import { executionResult } from './executionApi.js';
import { computePlanRevision, computePlanExecutionRevision } from './planRevision.js';
import { type ApplicationResult } from './result.js';
import { activeStates, type ExecutionAttempt } from '../execution/attempt.js';
import { ExecutionRuntime } from '../execution/runtime.js';
import { captureSnapshot } from '../execution/snapshot.js';
import { context, evidenceReadable, executionRepo, ExecutionError, listAttempts, readAttempt } from '../execution/store.js';
import { readPlan } from '../plan/planFs.js';
import { sameTaskInput } from '../planRun/planRun.js';
import { listStoredPlanRuns, newPlanRunId, planRunRoot } from '../planRun/store.js';
import { createRunWorkspace, createNodeWorkspace, landNode, alignIntegration, LandingUncertainError } from '../planRun/worktrees.js';
import { PARALLEL_RUN_SCHEMA, listStoredParallelRuns, nextParallelNode, parallelRoot, readParallelRun, saveParallelRun, type ParallelNode, type ParallelRun } from '../planRun/parallelRun.js';
export type { ParallelRun } from '../planRun/parallelRun.js';
export type ParallelRunQuery = { workspaceDir: string; projectId: string };
export type ParallelRunDetailQuery = ParallelRunQuery & { runId: string };
export type ParallelRunMutation = ParallelRunDetailQuery & { expectedRevision: string };
export type ParallelRunDetail = { run: ParallelRun; diagnostics: string[] };
type Context = ReturnType<typeof context>;
const detail = (run: ParallelRun): ParallelRunDetail => ({ run, diagnostics: run.diagnostics });
const git = (repo: string, ...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function unwrap<T>(result: ApplicationResult<T>): T { if (!result.ok) throw new ExecutionError(result.error.code as 'EXECUTION_CONFLICT', result.error.message); return result.data; }
const task = (q: ParallelRunQuery, itemId: string) => unwrap(showBacklogItem({ ...q, itemId })).item;
function invalid(message: string): never { throw new ExecutionError('EXECUTION_CONFLICT', message); }
function validateCommands(commands: string[][]) {
    if (!Array.isArray(commands) || !commands.length || commands.length > 20 || commands.some(command =>
        !Array.isArray(command) || !command.length || command.length > 128 || command.some(arg => typeof arg !== 'string' || arg.includes('\0')) || !command[0]?.trim()))
        throw new ExecutionError('EXECUTION_INVALID', 'Landing requires 1–20 structured commands with explicit executable and bounded arguments.');
}
export function createParallelRun(q: ParallelRunQuery & { planId: string; expectedRevision: string; baseCommit: string; commands: string[][]; model?: ParallelRun['model'] }) {
    return executionResult(() => {
        validateCommands(q.commands); const c = context(q.workspaceDir, q.projectId); const plan = readPlan(c.plans, q.planId);
        if (computePlanRevision(plan) !== q.expectedRevision) throw new ExecutionError('REVISION_MISMATCH', 'Plan revision changed.');
        if (plan.status !== 'approved' || !plan.materialization || plan.execution_policy?.max_parallel !== 2) invalid('Parallel execution requires an approved, materialized Plan with explicit max_parallel: 2 permission.');
        if (listStoredParallelRuns(parallelRoot(c.root), q.projectId).some(run => !['completed', 'stopped'].includes(run.state)) ||
            listStoredPlanRuns(planRunRoot(c.root), q.projectId).some(run => !['completed', 'stopped'].includes(run.state))) invalid('An unfinished run already owns this project.');
        const attempts = listAttempts(c.root, q.projectId);
        if (attempts.some(attempt => activeStates.includes(attempt.state))) invalid('Resolve existing active or unknown attempts first.');
        const mapping = plan.materialization.mapping;
        if (new Set(Object.values(mapping)).size !== Object.values(mapping).length) invalid('Plan mapping contains duplicate tasks.');
        const nodes: ParallelNode[] = plan.items.filter(item => item.item_type === 'task').map(draft => {
            const input = task(q, mapping[draft.key]!);
            if (input.source !== `plan:${plan.id}#${draft.key}` || input.item_type !== 'task' || !['todo', 'in_progress'].includes(input.status)) invalid('Parallel run requires current unfinished mapped tasks.');
            if (draft.depends_on.some(key => !input.depends_on.includes(mapping[key]!))) invalid('Materialized dependencies do not match the Plan.');
            return { key: draft.key, item_id: input.id, input: structuredClone(input), depends_on: [...input.depends_on], parallel: draft.parallel ?? false,
                resources: [...draft.resources ?? []], state: 'pending', attempt_ids: attempts.filter(a => a.item_id === input.id).map(a => a.id), workspace: null, landings: [] };
        });
        if (!nodes.length) invalid('Plan has no executable tasks.');
        const reached = new Set<string>();
        while (true) { const ready = nodes.filter(node => !reached.has(node.item_id) && node.depends_on.every(id => reached.has(id))); if (!ready.length) break; for (const node of ready) reached.add(node.item_id); }
        if (nodes.some(node => !reached.has(node.item_id))) invalid('Parallel graph has a cycle or a dependency outside this run; include an explicit node for every dependency.');
        const id = newPlanRunId(); const workspace = createRunWorkspace({ workspaceDir: c.workspace, repo: c.repo, runId: id, baseCommit: q.baseCommit });
        const at = new Date().toISOString();
        const run: ParallelRun = { schema: PARALLEL_RUN_SCHEMA, id, project_id: q.projectId, plan_id: plan.id, plan_revision: q.expectedRevision, plan_snapshot: structuredClone(plan),
            mapping: structuredClone(mapping), revision: '', created_at: at, updated_at: at, state: 'ready', capacity: 2, workspace, integration_head: workspace.baseCommit,
            commands: structuredClone(q.commands), nodes, controls: [], diagnostics: [] };
        if (q.model) run.model = structuredClone(q.model);
        return detail(saveParallelRun(parallelRoot(c.root, true), run, true));
    });
}
export function listParallelRuns(q: ParallelRunQuery & { planId?: string }) {
    return executionResult(() => ({ runs: listStoredParallelRuns(parallelRoot(context(q.workspaceDir, q.projectId).root), q.projectId).filter(run => !q.planId || run.plan_id === q.planId) }));
}
export function showParallelRun(q: ParallelRunDetailQuery) {
    return executionResult(() => detail(readParallelRun(parallelRoot(context(q.workspaceDir, q.projectId).root), q.runId, q.projectId)));
}
function accepted(c: Context, run: ParallelRun, node: ParallelNode, attempt: ExecutionAttempt, checkSnapshot = node.state !== 'landed') {
    if (attempt.state !== 'succeeded' || attempt.acceptance?.decision !== 'accepted' || !attempt.snapshot ||
        attempt.snapshot.digest !== attempt.acceptance.snapshot_digest || attempt.item_id !== node.item_id ||
        attempt.checkout?.run_id !== run.id || attempt.checkout.node_id !== node.workspace?.nodeId || !sameTaskInput(attempt.input.item, node.input) ||
        listAttempts(c.root, run.project_id).some(other => other.retry_of === attempt.id)) invalid(`Task ${node.item_id} lacks accepted owned-checkout evidence.`);
    const checks = new Map(attempt.verifications.filter(v => v.snapshot.digest === attempt.acceptance!.snapshot_digest).map(v => [v.command, v]));
    if (!checks.size || [...checks.values()].some(v => v.outcome !== 'passed' || !evidenceReadable(c.root, v.evidence_ref, v.evidence_digest))) invalid(`Task ${node.item_id} has missing or failed verification evidence.`);
    if (checkSnapshot && captureSnapshot(executionRepo(c, attempt)).digest !== attempt.acceptance.snapshot_digest) invalid(`Task ${node.item_id} checkout changed after acceptance.`);
}
function inputsValid(q: ParallelRunQuery, c: Context, run: ParallelRun, checkHead = true) {
    if (computePlanExecutionRevision(readPlan(c.plans, run.plan_id)) !== run.plan_revision) invalid('Plan input changed; use a newly reviewed run for revised scope.');
    for (const node of run.nodes) {
        const current = task(q, node.item_id);
        if (!sameTaskInput(current, node.input) || (node.attempt_ids.length === 0 && current.revision !== node.input.revision) || ['blocked', 'cancelled'].includes(current.status)) invalid(`Task input changed: ${node.item_id}.`);
        if (node.state === 'landed' && current.status !== 'done') invalid(`Landed task ${node.item_id} is no longer accepted.`);
    }
    if (checkHead && git(c.repo, 'rev-parse', run.workspace.integrationRef) !== run.integration_head) invalid('Integration ref drifted; inspect it before resuming.');
}

export function validateParallelRunCompletion(q: ParallelRunDetailQuery) {
    return executionResult(() => {
        const c = context(q.workspaceDir, q.projectId);
        const root = parallelRoot(c.root);
        const run = readParallelRun(root, q.runId, q.projectId);
        const latest = listStoredParallelRuns(root, q.projectId).filter(entry => entry.plan_id === run.plan_id)
            .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
        if (run.state !== 'completed' || latest?.id !== run.id) invalid('Completed delivery requires the latest matching parallel run to be completed.');
        inputsValid(q, c, run);
        const history = listAttempts(c.root, q.projectId);
        if (history.some(attempt => activeStates.includes(attempt.state))) invalid('Active or unknown work prevents completed delivery.');
        const attempts = run.nodes.map(node => {
            const id = node.attempt_ids.at(-1);
            if (node.state !== 'landed' || !id) invalid(`Task ${node.item_id} has not landed.`);
            const attempt = readAttempt(c.root, id, q.projectId);
            accepted(c, run, node, attempt, false);
            const latestAttempt = history.filter(entry => entry.item_id === node.item_id).at(-1);
            const landing = node.landings.at(-1);
            if (latestAttempt?.id !== attempt.id || !landing || landing.outcome !== 'landed' || !landing.candidateCommit ||
                landing.nodeCommit !== attempt.snapshot!.head || !landing.evidence.trim() ||
                JSON.stringify(JSON.parse(readFileSync(landing.evidenceFile, 'utf8'))) !== JSON.stringify(landing))
                invalid(`Task ${node.item_id} lacks current accepted submission and durable landed evidence.`);
            git(c.repo, 'merge-base', '--is-ancestor', landing.candidateCommit, run.integration_head);
            return attempt;
        });
        return { run, attempts, integrationHead: run.integration_head, integrationRef: run.workspace.integrationRef };
    });
}
export class ParallelRunRuntime {
    private landing = new Set<string>();
    constructor(private execution: ExecutionRuntime) {}
    private load(q: ParallelRunMutation) {
        if (this.landing.has(q.runId)) invalid('A landing is in progress; wait for its result.');
        const c = context(q.workspaceDir, q.projectId); const root = parallelRoot(c.root); const run = readParallelRun(root, q.runId, q.projectId);
        if (!q.expectedRevision || run.revision !== q.expectedRevision) throw new ExecutionError('REVISION_MISMATCH', 'Parallel run revision changed.');
        return { c, root, run };
    }
    private mutate(q: ParallelRunMutation, operation: (run: ParallelRun, c: Context) => void): ApplicationResult<ParallelRunDetail> {
        return executionResult(() => { const { run, c, root } = this.load(q); const before = JSON.stringify(run); operation(run, c); return detail(before === JSON.stringify(run) ? run : saveParallelRun(root, run)); });
    }
    private observe(run: ParallelRun, c: Context) {
        const diagnostics: string[] = [];
        for (const node of run.nodes) {
            try {
            if (node.state === 'pending') continue;
            const id = node.attempt_ids.at(-1); if (!id || !node.workspace) continue;
            const attempt = readAttempt(c.root, id, run.project_id);
            if (attempt.item_id !== node.item_id || attempt.checkout?.run_id !== run.id || attempt.checkout.node_id !== node.workspace.nodeId) invalid('Attempt does not belong to its managed node.');
            if (node.state === 'landed') {
                accepted(c, run, node, attempt); const landing = node.landings.at(-1);
                if (!landing || landing.outcome !== 'landed' || !landing.candidateCommit || JSON.stringify(JSON.parse(readFileSync(landing.evidenceFile, 'utf8'))) !== JSON.stringify(landing)) invalid(`Landed evidence unavailable for ${node.key}.`);
                git(c.repo, 'merge-base', '--is-ancestor', landing.candidateCommit, run.integration_head); continue;
            }
            if (node.state === 'landing') { diagnostics.push(`Landing for ${node.key} is awaiting inspection.`); continue; }
            if (attempt.acceptance?.decision === 'accepted') { accepted(c, run, node, attempt); node.state = 'awaiting_landing'; }
            else if (attempt.state === 'unknown') { node.state = 'unknown'; diagnostics.push(`Task ${node.item_id} is unknown; confirm prior work stopped.`); }
            else if (['running', 'stop_requested'].includes(attempt.state)) node.state = 'running';
            else if (attempt.state === 'succeeded' && !attempt.acceptance) node.state = 'awaiting_acceptance';
            else { node.state = 'failed'; diagnostics.push(`Task ${node.item_id} failed or requires rework; inspect and explicitly resume.`); }
            } catch (error) { diagnostics.push(error instanceof Error ? error.message : `Task ${node.item_id} execution is unavailable.`); }
        }
        if (diagnostics.length) { run.state = 'paused'; run.diagnostics = diagnostics; }
    }
    advance(q: ParallelRunMutation) {
        return this.mutate(q, (run, c) => {
            if (['completed', 'stopped'].includes(run.state)) return;
            this.observe(run, c);
            try { inputsValid(q, c, run); }
            catch (error) {
                run.state = 'paused';
                run.diagnostics = [...run.diagnostics, error instanceof Error ? error.message : 'Parallel inputs are unavailable.'];
                run.diagnostics = [...new Set(run.diagnostics)];
                return;
            }
            try {
                if (run.state === 'paused') return;
                if (run.nodes.every(node => node.state === 'landed')) { run.state = 'completed'; return; }
                let node: ParallelNode | undefined;
                while ((node = nextParallelNode(run))) {
                    if (!this.execution.available) throw new ExecutionError('RUNNER_UNAVAILABLE', 'Configure a runner before preparing node workspaces.');
                    const nodeId = `${node.key}-${node.attempt_ids.length + 1}`;
                    const workspace = node.workspace?.nodeId === nodeId ? node.workspace : createNodeWorkspace(run.workspace, nodeId);
                    node.workspace = workspace;
                    const prior = node.attempt_ids.at(-1);
                    const rework = run.controls.findLast(control => control.action === 'rework' && control.node_key === node!.key);
                    const lastLanding = node.landings.at(-1);
                    const reworkInstructions = rework ? `\nRework requested: ${rework.note.slice(0, 8000)}${lastLanding && lastLanding.outcome !== 'landed'
                        ? `\nPrevious landing ${lastLanding.outcome}: ${lastLanding.evidenceFile}\n${lastLanding.evidence.slice(0, 4000)}` : ''}` : '';
                    const result = unwrap(this.execution.startManaged({ ...q, model: run.model, itemId: node.item_id, expectedRevision: task(q, node.item_id).revision,
                        instructions: `Execute Plan ${run.plan_id} node ${node.key} in this owned checkout. Do not change the original repository or task/Plan state.\n${node.input.body}${reworkInstructions}`,
                        ...(prior ? { retryOf: prior } : {}) }, { run_id: run.id, node_id: workspace.nodeId }));
                    node.workspace = workspace; node.attempt_ids.push(result.attempt.id); node.state = 'running';
                    if (!['running', 'stop_requested'].includes(result.attempt.state)) { this.observe(run, c); break; }
                }
                if ((run.state as ParallelRun['state']) !== 'paused') { run.state = 'running'; run.diagnostics = []; }
            } catch (error) { run.state = 'paused'; run.diagnostics = [error instanceof Error ? error.message : 'Parallel dispatch failed.']; }
        });
    }
    pause(q: ParallelRunMutation & { note?: string }) {
        return this.mutate(q, run => { if (['completed', 'stopped'].includes(run.state)) invalid('Ended run cannot pause.'); run.state = 'paused'; run.controls.push({ action: 'pause', note: q.note ?? 'Paused by user.', at: new Date().toISOString() }); });
    }
    resume(q: ParallelRunMutation & { note: string; integrationHead?: string }) {
        return this.mutate(q, (run, c) => {
            if (run.state !== 'paused' || !q.note?.trim()) invalid('Resume requires a paused run and an inspection note.');
            inputsValid(q, c, run, false);
            if (run.nodes.some(node => node.state === 'landing')) invalid('Inspect uncertain landing before resuming.');
            if (listAttempts(c.root, q.projectId).some(attempt => attempt.state === 'unknown' || (activeStates.includes(attempt.state) && attempt.checkout?.run_id !== run.id))) invalid('Unknown or unrelated work blocks resume.');
            const head = git(c.repo, 'rev-parse', run.workspace.integrationRef);
            if (head !== run.integration_head && q.integrationHead !== head) invalid('Supply the inspected current integrationHead before accepting ref drift.');
            if (q.integrationHead !== undefined && q.integrationHead !== head) throw new ExecutionError('REVISION_MISMATCH', 'Inspected integration head changed.');
            for (const node of run.nodes.filter(node => node.state === 'landed')) git(c.repo, 'merge-base', '--is-ancestor', node.landings.at(-1)!.candidateCommit!, head);
            if (head !== run.integration_head) alignIntegration(run.workspace, run.integration_head, head);
            run.integration_head = head; this.observe(run, c);
            for (const node of run.nodes) if (['failed', 'unknown'].includes(node.state)) {
                const attempt = readAttempt(c.root, node.attempt_ids.at(-1)!, q.projectId);
                if (activeStates.includes(attempt.state)) invalid('Previous work must be confirmed stopped before retrying.');
                node.state = 'pending';
            }
            run.state = 'ready'; run.diagnostics = []; run.controls.push({ action: 'resume', note: q.note, at: new Date().toISOString() });
        });
    }
    closeStopped(q: ParallelRunMutation & { note: string }) {
        return this.mutate(q, (run, c) => {
            if (['completed', 'stopped'].includes(run.state) || !q.note?.trim()) invalid('Ending a run requires an unfinished scope and inspection note.');
            if (run.nodes.some(node => node.state === 'landing') || listAttempts(c.root, q.projectId).some(attempt => activeStates.includes(attempt.state))) invalid('Active or unknown work must settle before ending this scope.');
            run.state = 'stopped'; run.controls.push({ action: 'close_stopped', note: q.note, at: new Date().toISOString() });
        });
    }
    rework(q: ParallelRunMutation & { nodeKey: string; note: string }) {
        return this.mutate(q, (run, c) => {
            if (['completed', 'stopped'].includes(run.state) || !q.note?.trim()) invalid('Rework requires an unfinished run and an inspection note.');
            inputsValid(q, c, run);
            const node = run.nodes.find(entry => entry.key === q.nodeKey);
            if (!node?.workspace || !['awaiting_landing', 'awaiting_acceptance', 'failed'].includes(node.state)) invalid('Only accepted work that has not landed can be reopened.');
            const attemptId = node.attempt_ids.at(-1)!;
            const attempt = readAttempt(c.root, attemptId, q.projectId);
            if (activeStates.includes(attempt.state)) invalid('Active or unknown work cannot be reopened.');
            accepted(c, run, node, attempt, false);
            const current = task(q, node.item_id);
            if (current.status !== 'done') invalid('Accepted task must be done before requesting managed rework.');
            unwrap(updateBacklogItemStatus({ ...q, itemId: node.item_id, status: 'in_progress', expectedRevision: current.revision }));
            node.state = 'pending'; run.state = 'paused'; run.diagnostics = [];
            run.controls.push({ action: 'rework', note: q.note, at: new Date().toISOString(), node_key: node.key, attempt_id: attempt.id });
        });
    }
    async land(q: ParallelRunMutation & { nodeKey: string }): Promise<ApplicationResult<ParallelRunDetail>> {
        const prepared = executionResult(() => {
            const loaded = this.load(q); const { run, c } = loaded;
            if (['completed', 'stopped'].includes(run.state)) invalid('Ended run cannot land work.');
            inputsValid(q, c, run); this.observe(run, c);
            const node = run.nodes.find(n => n.key === q.nodeKey);
            if (!node || node.state !== 'awaiting_landing' || !node.workspace) invalid('Node requires accepted verification before landing.');
            accepted(c, run, node, readAttempt(c.root, node.attempt_ids.at(-1)!, q.projectId));
            if (task(q, node.item_id).status !== 'done') invalid('Landing requires the task to retain its accepted status.');
            node.state = 'landing'; saveParallelRun(loaded.root, run); return { ...loaded, node };
        });
        if (!prepared.ok) return prepared;
        const { run, root, node } = prepared.data; const revision = run.revision; this.landing.add(run.id);
        try {
            const landing = await landNode(run.workspace, node.workspace!, async candidate => {
                const evidence: string[] = [];
                for (const command of run.commands) {
                    try { const output = await promisify(execFile)(command[0]!, command.slice(1), { cwd: candidate.dir, timeout: 120000, maxBuffer: 16 * 1024 * 1024 }); evidence.push(`${JSON.stringify(command)}\n${output.stdout}${output.stderr}`); }
                    catch (error) { const failed = error as { stdout?: string; stderr?: string; message?: string }; evidence.push(`${JSON.stringify(command)}\n${failed.stdout ?? ''}${failed.stderr ?? ''}\n${failed.message ?? 'Command failed'}`); return { passed: false, evidence: evidence.join('\n') }; }
                }
                return { passed: true, evidence: evidence.join('\n') };
            });
            return executionResult(() => {
                if (readParallelRun(root, run.id, q.projectId).revision !== revision) throw new ExecutionError('REVISION_MISMATCH', 'Run changed during landing; inspect persisted candidate evidence.');
                node.landings.push(landing);
                if (landing.outcome === 'landed') { node.state = 'landed'; run.integration_head = landing.candidateCommit!; if (run.nodes.every(n => n.state === 'landed')) { run.state = 'completed'; run.diagnostics = []; } }
                else { node.state = 'awaiting_landing'; run.state = 'paused'; run.diagnostics = [`Landing ${node.key}: ${landing.outcome}. Inspect ${landing.evidenceFile}.`]; }
                return detail(saveParallelRun(root, run));
            });
        } catch (error) {
            return executionResult(() => {
                if (readParallelRun(root, run.id, q.projectId).revision !== revision) throw new ExecutionError('REVISION_MISMATCH', 'Run changed during landing.');
                node.state = error instanceof LandingUncertainError ? 'landing' : 'awaiting_landing';
                run.state = 'paused'; run.diagnostics = [error instanceof Error ? error.message : 'Landing failed.'];
                return detail(saveParallelRun(root, run));
            });
        } finally { this.landing.delete(run.id); }
    }
}
