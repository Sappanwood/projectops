import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCli } from '../src/app.js';
import { createParallelRun, showParallelRun, validateParallelRunCompletion, ParallelRunRuntime } from '../src/application/parallelRunApi.js';
import { computePlanRevision } from '../src/application/planRevision.js';
import { readPlan } from '../src/plan/planFs.js';
import { decideExecution, showExecution, verifyExecution } from '../src/application/executionApi.js';
import { ExecutionRuntime, type RunnerResult } from '../src/execution/runtime.js';
import { applicationFailure, type ApplicationResult } from '../src/application/result.js';
import { saveParallelRun, type ParallelRun } from '../src/planRun/parallelRun.js';
import { showBacklogItem, updateBacklogItemContent } from '../src/application/backlogApi.js';
const git = (repo: string, ...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function data<T>(result: ApplicationResult<T>): T { assert.equal(result.ok, true, JSON.stringify(result)); if (!result.ok) throw Error(); return result.data; }
function setup(options: { permit?: boolean; shared?: boolean; serialNode?: boolean } = {}) {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), 'parallel-run-')); const repo = path.join(workspaceDir, 'repo');
    const cli = (args: string[]) => { const out: string[] = []; assert.equal(runCli(args, { stdout: x => out.push(x), stderr: x => out.push(x) }, workspaceDir), 0, out.join('\n')); };
    cli(['init']); mkdirSync(repo); cli(['project', 'add', 'repo']); cli(['backlog', 'init', 'repo']);
    git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Parallel Fixture'); git(repo, 'config', 'user.email', 'parallel@example.invalid');
    writeFileSync(path.join(repo, 'base.txt'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'Base');
    const baseCommit = git(repo, 'rev-parse', 'HEAD'); const planId = 'plan-diamond';
    writeFileSync(path.join(workspaceDir, 'ops/repo/plans', `${planId}.json`), JSON.stringify({
        schema: 'plan/Plan@1', id: planId, title: 'Diamond', goal: 'Deliver diamond', status: 'approved',
        approval: { approved_at: new Date().toISOString(), review_note: 'Fixture approved' },
        ...(options.permit === false ? {} : { execution_policy: { max_parallel: 2 } }),
        items: ['a', 'b', 'c', 'd'].map(key => ({ key, title: key, item_type: 'task', priority: 'P1', body: `Implement ${key}`,
            parallel: !(options.serialNode && key === 'c'), resources: options.shared && ['b', 'c'].includes(key) ? ['database'] : [],
            depends_on: key === 'a' ? [] : key === 'd' ? ['b', 'c'] : ['a'] })),
    }));
    cli(['plan', 'materialize', 'repo', planId]); const plan = readPlan(path.join(workspaceDir, 'ops/repo/plans'), planId);
    const q = { workspaceDir, projectId: 'repo', planId };
    const running = new Map<string, { dir: string; end: (r: RunnerResult) => void }>();
    const execution = new ExecutionRuntime({ start(a, context) { return { completion: new Promise(resolve => running.set(a.item_id, { dir: context.repo, end: resolve })), stop() {} }; } });
    const scheduler = new ParallelRunRuntime(execution);
    const createRequest = { ...q, expectedRevision: computePlanRevision(plan), baseCommit, commands: [[process.execPath, '-e', 'process.exit(0)']] };
    const create = () => data(createParallelRun(createRequest)).run;
    const mutation = (run: ParallelRun) => ({ ...q, runId: run.id, expectedRevision: run.revision });
    const current = (run: ParallelRun) => data(showParallelRun({ ...q, runId: run.id })).run;
    const finish = async (run: ParallelRun, key: string, outcome: RunnerResult['outcome'] = 'succeeded') => {
        const node = run.nodes.find(n => n.key === key)!; const handle = running.get(node.item_id)!;
        if (outcome === 'succeeded') { writeFileSync(path.join(handle.dir, `${key}.txt`), `${key}\n`); git(handle.dir, 'add', '.'); git(handle.dir, 'commit', '-qm', `Implement ${key}`); }
        handle.end({ outcome, summary: outcome }); await new Promise(resolve => setImmediate(resolve));
        if (outcome === 'succeeded') {
            const attemptId = node.attempt_ids.at(-1)!; let a = data(showExecution({ ...q, attemptId })).attempt;
            a = data(verifyExecution({ ...q, attemptId, expectedRevision: a.revision, command: 'fixture check', outcome: 'passed', evidence: 'Passed in owned checkout' })).attempt;
            data(decideExecution({ ...q, attemptId, expectedRevision: a.revision, decision: 'accepted', note: 'Reviewed owned checkout' }));
        }
    };
    const land = async (run: ParallelRun, key: string) => data(await scheduler.land({ ...mutation(run), nodeKey: key })).run;
    return { q, repo, baseCommit, plan, createRequest, create, mutation, current, running, scheduler, execution, finish, land };
}
test('parallel diamond executes two real handles in owned checkouts and only landed dependencies unlock join', async () => {
    const f = setup(); let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
    assert.equal(f.running.size, 1); assert.notEqual(f.running.values().next().value!.dir, f.repo);
    await f.finish(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.nodes[0]!.state, 'awaiting_landing'); assert.equal(f.running.size, 1);
    run = await f.land(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.nodes.filter(n => n.state === 'running').length, 2);
    const b = run.nodes.find(n => n.key === 'b')!; const c = run.nodes.find(n => n.key === 'c')!;
    assert.notEqual(f.running.get(b.item_id)!.dir, f.running.get(c.item_id)!.dir);
    for (const node of [b, c]) assert.equal(readFileSync(path.join(f.running.get(node.item_id)!.dir, 'a.txt'), 'utf8'), 'a\n');
    await f.finish(run, 'b'); await f.finish(run, 'c'); run = data(f.scheduler.advance(f.mutation(run))).run;
    run = await f.land(run, 'b'); assert.equal(run.nodes.find(n => n.key === 'd')!.state, 'pending');
    run = await f.land(run, 'c'); run = data(f.scheduler.advance(f.mutation(run))).run;
    const d = run.nodes.find(n => n.key === 'd')!;
    for (const file of ['b.txt', 'c.txt']) assert.equal(readFileSync(path.join(f.running.get(d.item_id)!.dir, file), 'utf8').trim(), file[0]);
    await f.finish(run, 'd'); run = data(f.scheduler.advance(f.mutation(run))).run; run = await f.land(run, 'd');
    assert.equal(run.state, 'completed'); assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.baseCommit); assert.equal(git(f.repo, 'status', '--porcelain'), '');
    const query = { ...f.q, runId: run.id };
    const completion = data(validateParallelRunCompletion(query));
    assert.equal(completion.attempts.length, 4);
    assert.equal(completion.integrationHead, run.integration_head);
    const landing = run.nodes[0]!.landings.at(-1)!;
    const evidence = readFileSync(landing.evidenceFile, 'utf8');
    writeFileSync(landing.evidenceFile, 'changed historical landing evidence');
    assert.equal(validateParallelRunCompletion(query).ok, false);
    writeFileSync(landing.evidenceFile, evidence);
    git(f.repo, 'update-ref', run.workspace.integrationRef, f.baseCommit, run.integration_head);
    assert.equal(validateParallelRunCompletion(query).ok, false);
});
test('parallel execution requires explicit permission and respects resources and serial nodes', async () => {
    const noPermit = setup({ permit: false }); assert.equal(createParallelRun(noPermit.createRequest).ok, false);
    for (const options of [{ shared: true }, { serialNode: true }]) {
        const f = setup(options); let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
        await f.finish(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run; run = await f.land(run, 'a');
        run = data(f.scheduler.advance(f.mutation(run))).run;
        assert.equal(run.nodes.filter(n => n.state === 'running').length, 1);
        assert.equal(run.nodes.find(n => n.key === 'c')!.state, 'pending');
    }
});
test('failed branch pauses dispatch, keeps its sibling and blocks join until explicit resume', async () => {
    const f = setup(); let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
    await f.finish(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run; run = await f.land(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run;
    await f.finish(run, 'b', 'failed'); run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.state, 'paused'); assert.equal(run.nodes.find(n => n.key === 'c')!.state, 'running');
    assert.equal(run.nodes.find(n => n.key === 'd')!.state, 'pending');
    run = data(f.scheduler.resume({ ...f.mutation(run), note: 'Inspect failure and retry only B' })).run;
    run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.nodes.find(n => n.key === 'b')!.attempt_ids.length, 2);
    assert.equal(run.nodes.find(n => n.key === 'c')!.attempt_ids.length, 1);
    f.execution.recover({ ...f.q });
    const restarted = new ExecutionRuntime(); restarted.recover(f.q);
    run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.state, 'paused'); assert.equal(f.scheduler.resume({ ...f.mutation(run), note: 'Cannot ignore unknown' }).ok, false);
});
test('landing validation failure and integration ref drift never unlock descendants', async () => {
    const f = setup(); f.createRequest.commands = [[process.execPath, '-e', 'process.exit(1)']];
    let run = data(f.scheduler.advance(f.mutation(f.create()))).run; await f.finish(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run;
    run = await f.land(run, 'a'); assert.equal(run.state, 'paused'); assert.equal(run.nodes[0]!.state, 'awaiting_landing');
    assert.equal(run.nodes[0]!.landings.at(-1)!.outcome, 'verification_failed');
    assert.equal(run.nodes.find(n => n.key === 'b')!.state, 'pending');
    const drift = setup(); let changed = data(drift.scheduler.advance(drift.mutation(drift.create()))).run;
    await drift.finish(changed, 'a'); changed = data(drift.scheduler.advance(drift.mutation(changed))).run;
    const a = changed.nodes[0]!; const nodeHead = git(drift.running.get(a.item_id)!.dir, 'rev-parse', 'HEAD');
    git(drift.repo, 'update-ref', changed.workspace.integrationRef, nodeHead, drift.baseCommit);
    assert.equal((await drift.scheduler.land({ ...drift.mutation(changed), nodeKey: 'a' })).ok, false);
    assert.equal(drift.current(changed).nodes[0]!.state, 'awaiting_landing');
});

test('accepted landing failure can explicitly request rework without rewriting historical acceptance', async () => {
    const f = setup();
    f.createRequest.commands = [[process.execPath, '-e', "if (!require('node:fs').existsSync('repair.txt')) process.exit(1)"]];
    let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
    await f.finish(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run;
    const oldId = run.nodes[0]!.attempt_ids.at(-1)!;
    const oldAttempt = data(showExecution({ ...f.q, attemptId: oldId })).attempt;
    const oldDir = run.nodes[0]!.workspace!.dir;
    run = await f.land(run, 'a');
    assert.equal(run.nodes[0]!.landings.at(-1)!.outcome, 'verification_failed');
    assert.equal(f.scheduler.rework({ ...f.mutation(run), nodeKey: 'a', note: '' }).ok, false);
    run = data(f.scheduler.rework({ ...f.mutation(run), nodeKey: 'a', note: 'Integration check requires repair file' })).run;
    assert.equal(data(showBacklogItem({ ...f.q, itemId: run.nodes[0]!.item_id })).item.status, 'in_progress');
    assert.equal(run.nodes[0]!.state, 'pending');
    assert.deepEqual(data(showExecution({ ...f.q, attemptId: oldId })).attempt, oldAttempt);
    run = data(f.scheduler.resume({ ...f.mutation(run), note: 'Retry accepted work after integration rejection' })).run;
    run = data(f.scheduler.advance(f.mutation(run))).run;
    const node = run.nodes[0]!;
    assert.notEqual(node.workspace!.dir, oldDir);
    const attempt = data(showExecution({ ...f.q, attemptId: node.attempt_ids.at(-1)! })).attempt;
    assert.equal(attempt.retry_of, oldId);
    assert.match(attempt.input.instructions, /Integration check requires repair file/);
    assert.ok(attempt.input.instructions.includes(node.landings.at(-1)!.evidenceFile));
    writeFileSync(path.join(node.workspace!.dir, 'repair.txt'), 'repaired');
    await f.finish(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run;
    run = await f.land(run, 'a');
    assert.equal(run.nodes[0]!.state, 'landed');
    assert.equal(run.nodes[0]!.landings.length, 2);
    assert.equal(f.scheduler.rework({ ...f.mutation(run), nodeKey: 'a', note: 'Cannot reopen landed work' }).ok, false);
});

test('managed acceptance requires committed clean submission and verification of that commit', async () => {
    const f = setup(); const run = data(f.scheduler.advance(f.mutation(f.create()))).run;
    const node = run.nodes[0]!; const handle = f.running.get(node.item_id)!;
    writeFileSync(path.join(handle.dir, 'uncommitted.txt'), 'not submitted');
    handle.end({ outcome: 'succeeded', summary: 'Uncommitted work' }); await new Promise(resolve => setImmediate(resolve));
    const attemptId = node.attempt_ids.at(-1)!;
    let attempt = data(showExecution({ ...f.q, attemptId })).attempt;
    attempt = data(verifyExecution({ ...f.q, attemptId, expectedRevision: attempt.revision, command: 'check', outcome: 'passed', evidence: 'Checks passed on uncommitted files' })).attempt;
    const rejected = decideExecution({ ...f.q, attemptId, expectedRevision: attempt.revision, decision: 'accepted', note: 'Try premature acceptance' });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.error.message, /commit|submit/i);
    git(handle.dir, 'add', '.'); git(handle.dir, 'commit', '-qm', 'Submit work');
    assert.equal(decideExecution({ ...f.q, attemptId, expectedRevision: attempt.revision, decision: 'accepted', note: 'Old verification is stale' }).ok, false);
    attempt = data(verifyExecution({ ...f.q, attemptId, expectedRevision: attempt.revision, command: 'check', outcome: 'passed', evidence: 'Submitted commit checked' })).attempt;
    assert.equal(decideExecution({ ...f.q, attemptId, expectedRevision: attempt.revision, decision: 'accepted', note: 'Reviewed submitted commit' }).ok, true);
});

test('parallel lifecycle continues to observe ended work after input drift', async () => {
    const f = setup(); let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
    const item = data(showBacklogItem({ ...f.q, itemId: run.nodes[3]!.item_id })).item;
    data(updateBacklogItemContent({ ...f.q, itemId: item.id, title: 'Revised join', expectedRevision: item.revision }));
    run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.state, 'paused');
    await f.finish(run, 'a', 'failed');
    run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.nodes[0]!.state, 'failed');
    assert.match(run.diagnostics.join(' '), /input/i);
    assert.equal(f.scheduler.closeStopped({ ...f.mutation(run), note: 'All work settled; close old input' }).ok, true);
});

test('explicitly accepting integration ref drift aligns only its owned detached checkout', async () => {
    const f = setup(); let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
    await f.finish(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run;
    const next = git(run.nodes[0]!.workspace!.dir, 'rev-parse', 'HEAD');
    git(f.repo, 'update-ref', run.workspace.integrationRef, next, run.integration_head);
    run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.state, 'paused');
    assert.equal(f.scheduler.resume({ ...f.mutation(run), note: 'Missing inspected head' }).ok, false);
    run = data(f.scheduler.resume({ ...f.mutation(run), note: 'Inspected ref includes accepted A', integrationHead: next })).run;
    assert.equal(git(run.workspace.integrationDir, 'rev-parse', 'HEAD'), next);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.baseCommit);
    run = await f.land(run, 'a');
    assert.equal(run.nodes[0]!.state, 'landed');
});

test('a run started without a runner can resume after a runner is configured', () => {
    const f = setup(); const unavailable = new ParallelRunRuntime(new ExecutionRuntime());
    let run = data(unavailable.advance(f.mutation(f.create()))).run;
    assert.equal(run.state, 'paused');
    run = data(f.scheduler.resume({ ...f.mutation(run), note: 'Runner configured; continue' })).run;
    run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.nodes[0]!.state, 'running');
    assert.equal(f.running.size, 1);
});

test('failed launch records its prepared worktree and safely reuses it on resume', () => {
    const f = setup();
    const start = f.execution.startManaged.bind(f.execution);
    f.execution.startManaged = () => applicationFailure('EXECUTION_CONFLICT', 'Fixture launch rejected before creating an attempt');
    let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
    assert.equal(run.state, 'paused');
    const prepared = run.nodes[0]!.workspace;
    assert.ok(prepared);
    assert.equal(run.nodes[0]!.attempt_ids.length, 0);
    f.execution.startManaged = start;
    run = data(f.scheduler.resume({ ...f.mutation(run), note: 'Transient start failure resolved' })).run;
    run = data(f.scheduler.advance(f.mutation(run))).run;
    assert.equal(run.nodes[0]!.state, 'running');
    assert.equal(run.nodes[0]!.workspace!.dir, prepared.dir);
});

test('landing rechecks selected acceptance after checkout or evidence changes', async () => {
    for (const changed of ['checkout', 'evidence']) {
        const f = setup(); let run = data(f.scheduler.advance(f.mutation(f.create()))).run;
        await f.finish(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run;
        const node = run.nodes[0]!;
        if (changed === 'checkout') {
            writeFileSync(path.join(node.workspace!.dir, 'late.txt'), 'unreviewed late commit');
            git(node.workspace!.dir, 'add', '.'); git(node.workspace!.dir, 'commit', '-qm', 'Unreviewed addition');
        } else {
            const attempt = data(showExecution({ ...f.q, attemptId: node.attempt_ids.at(-1)! })).attempt;
            writeFileSync(path.join(f.q.workspaceDir, 'ops/repo/executions', attempt.verifications[0]!.evidence_ref), 'changed evidence');
        }
        const result = await f.scheduler.land({ ...f.mutation(run), nodeKey: 'a' });
        assert.equal(result.ok, false, changed);
        assert.equal(git(f.repo, 'rev-parse', run.workspace.integrationRef), f.baseCommit);
    }
});

test('a failure after integration ref publication remains awaiting inspection and cannot replay', async () => {
    const f = setup();
    let run = f.create();
    const indexLock = path.join(git(run.workspace.integrationDir, 'rev-parse', '--absolute-git-dir'), 'index.lock');
    run.commands = [[process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(indexLock)}, '')`]];
    run = saveParallelRun(path.join(f.q.workspaceDir, 'ops/repo/executions/parallel-runs'), run);
    run = data(f.scheduler.advance(f.mutation(run))).run;
    await f.finish(run, 'a'); run = data(f.scheduler.advance(f.mutation(run))).run;
    run = await f.land(run, 'a');
    assert.notEqual(git(f.repo, 'rev-parse', run.workspace.integrationRef), f.baseCommit);
    assert.equal(run.state, 'paused');
    assert.equal(run.nodes[0]!.state, 'landing');
    assert.match(run.diagnostics.join('\n'), /inspect|inspection/i);
    assert.equal(f.scheduler.resume({ ...f.mutation(run), note: 'Must not replay' }).ok, false);
    assert.equal((await f.scheduler.land({ ...f.mutation(run), nodeKey: 'a' })).ok, false);
});
