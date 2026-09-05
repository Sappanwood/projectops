import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRunWorkspace, createNodeWorkspace, landNode, cleanupNodeWorkspace, alignIntegration, type LandingUncertainError } from '../src/planRun/worktrees.js';
const git = (repo: string, ...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function setup() {
    const workspaceDir = mkdtempSync(path.join(tmpdir(), 'plan-worktrees-'));
    const repo = path.join(workspaceDir, 'repo'); mkdirSync(repo);
    git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Plan Test'); git(repo, 'config', 'user.email', 'plan-test@example.invalid');
    writeFileSync(path.join(repo, 'base.txt'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'Base');
    return { workspaceDir, repo, runId: 'run-fixture', baseCommit: git(repo, 'rev-parse', 'HEAD') };
}
function commit(dir: string, file: string, text: string) { writeFileSync(path.join(dir, file), text); git(dir, 'add', file); git(dir, 'commit', '-qm', file); return git(dir, 'rev-parse', 'HEAD'); }
const passed = async () => ({ passed: true, evidence: 'Isolated verification passed.' });
test('diamond workspaces land serially over the latest integration without changing user checkout', async () => {
    const input = setup(); const run = createRunWorkspace(input);
    const a = createNodeWorkspace(run, 'a'); const b = createNodeWorkspace(run, 'b');
    commit(a.dir, 'a.txt', 'A\n'); commit(b.dir, 'b.txt', 'B\n');
    const [first, second] = await Promise.all([landNode(run, a, passed), landNode(run, b, async candidate => {
        assert.equal(readFileSync(path.join(candidate.dir, 'a.txt'), 'utf8'), 'A\n');
        assert.equal(readFileSync(path.join(candidate.dir, 'b.txt'), 'utf8'), 'B\n'); return passed();
    })]);
    assert.equal(first.outcome, 'landed'); assert.equal(second.outcome, 'landed');
    const diamond = createNodeWorkspace(run, 'diamond');
    assert.equal(readFileSync(path.join(diamond.dir, 'a.txt'), 'utf8'), 'A\n');
    assert.equal(readFileSync(path.join(diamond.dir, 'b.txt'), 'utf8'), 'B\n');
    commit(diamond.dir, 'diamond.txt', 'A+B\n');
    assert.equal((await landNode(run, diamond, passed)).outcome, 'landed');
    assert.equal(git(input.repo, 'rev-parse', 'HEAD'), input.baseCommit);
    assert.equal(git(input.repo, 'status', '--porcelain'), '');
    assert.equal(existsSync(path.join(input.repo, 'a.txt')), false);
    assert.equal(readFileSync(path.join(run.integrationDir, 'diamond.txt'), 'utf8'), 'A+B\n');
});
test('workspace and ref creation reject no-clobber and static symlink violations', () => {
    const input = setup(); const run = createRunWorkspace(input);
    assert.throws(() => createRunWorkspace(input));
    const node = createNodeWorkspace(run, 'node'); assert.throws(() => createNodeWorkspace(run, 'node'));
    assert.equal(git(node.dir, 'rev-parse', 'HEAD'), input.baseCommit);
    const unsafe = setup(); const outside = mkdtempSync(path.join(tmpdir(), 'plan-worktrees-outside-'));
    symlinkSync(outside, path.join(unsafe.workspaceDir, '.pops'));
    assert.throws(() => createRunWorkspace(unsafe), /symlink|symbolic/i);
    const collision = setup(); git(collision.repo, 'update-ref', 'refs/heads/pops/run-fixture/integration', collision.baseCommit);
    assert.throws(() => createRunWorkspace(collision));
    assert.equal(git(collision.repo, 'rev-parse', 'refs/heads/pops/run-fixture/integration'), collision.baseCommit);
    assert.throws(() => createNodeWorkspace(run, '../escape'));
});
test('merge conflicts, failed validation and integration ref drift preserve evidence without landing', async () => {
    const input = setup(); const run = createRunWorkspace(input);
    const a = createNodeWorkspace(run, 'a'); const b = createNodeWorkspace(run, 'b');
    commit(a.dir, 'base.txt', 'A\n'); commit(b.dir, 'base.txt', 'B\n');
    assert.equal((await landNode(run, a, passed)).outcome, 'landed');
    const before = git(input.repo, 'rev-parse', run.integrationRef);
    const conflict = await landNode(run, b, async () => { throw Error('must not verify conflicts'); });
    assert.equal(conflict.outcome, 'conflict'); assert(existsSync(conflict.evidenceFile)); assert(existsSync(conflict.candidateDir));
    assert.equal(git(input.repo, 'rev-parse', run.integrationRef), before);
    const c = createNodeWorkspace(run, 'c'); const nodeCommit = commit(c.dir, 'c.txt', 'C\n');
    const failed = await landNode(run, c, async () => ({ passed: false, evidence: 'Test rejected C.' }));
    assert.equal(failed.outcome, 'verification_failed'); assert.match(readFileSync(failed.evidenceFile, 'utf8'), /Test rejected C/);
    assert.equal(git(input.repo, 'rev-parse', run.integrationRef), before);
    const drift = await landNode(run, c, async () => {
        git(input.repo, 'update-ref', run.integrationRef, nodeCommit, before); return passed();
    });
    assert.equal(drift.outcome, 'ref_drift'); assert.equal(git(input.repo, 'rev-parse', run.integrationRef), nodeCommit);
});
test('cleanup requires confirmation and only removes a clean worktree owned by the current run', () => {
    const input = setup(); const run = createRunWorkspace(input); const node = createNodeWorkspace(run, 'node');
    assert.throws(() => cleanupNodeWorkspace(run, 'node', { confirmed: false }));
    assert.throws(() => cleanupNodeWorkspace(run, '../repo', { confirmed: true }));
    writeFileSync(path.join(node.dir, 'untracked.txt'), 'preserve');
    assert.throws(() => cleanupNodeWorkspace(run, 'node', { confirmed: true }));
    git(node.dir, 'add', '.'); git(node.dir, 'commit', '-qm', 'Keep work');
    cleanupNodeWorkspace(run, 'node', { confirmed: true }); assert.equal(existsSync(node.dir), false);
    assert(existsSync(input.repo)); assert.equal(git(input.repo, 'rev-parse', 'HEAD'), input.baseCommit);
});
test('landing rejects verification that changes the candidate or its owned integration checkout', async () => {
    const input = setup(); const run = createRunWorkspace(input); const node = createNodeWorkspace(run, 'node');
    commit(node.dir, 'feature.txt', 'Feature\n');
    const changed = await landNode(run, node, async candidate => {
        writeFileSync(path.join(candidate.dir, 'feature.txt'), 'Unverified replacement\n'); return passed();
    });
    assert.equal(changed.outcome, 'verification_failed'); assert.equal(git(input.repo, 'rev-parse', run.integrationRef), input.baseCommit);
    const integrationChanged = await landNode(run, node, async () => {
        writeFileSync(path.join(run.integrationDir, 'base.txt'), 'Concurrent local change\n'); return passed();
    });
    assert.equal(integrationChanged.outcome, 'verification_failed');
    assert.equal(readFileSync(path.join(run.integrationDir, 'base.txt'), 'utf8'), 'Concurrent local change\n');
    assert.equal(git(input.repo, 'rev-parse', run.integrationRef), input.baseCommit);
});
test('Git metadata outside the workspace cannot receive run refs', () => {
    const input = setup(); const outside = mkdtempSync(path.join(tmpdir(), 'plan-git-outside-'));
    const moved = path.join(outside, 'git'); renameSync(path.join(input.repo, '.git'), moved); symlinkSync(moved, path.join(input.repo, '.git'));
    assert.throws(() => createRunWorkspace(input), /symbolic|outside|metadata/i);
    assert.equal(existsSync(path.join(moved, 'refs', 'heads', 'pops')), false);
});
test('landing refuses integration branch attachment and detached HEAD drift before updating refs', async () => {
    for (const change of ['attach', 'head']) {
        const input = setup(); const run = createRunWorkspace(input); const node = createNodeWorkspace(run, 'node');
        const nodeCommit = commit(node.dir, 'feature.txt', 'Feature\n'); const userBranch = git(input.repo, 'symbolic-ref', 'HEAD');
        const result = await landNode(run, node, async () => {
            if (change === 'attach') git(run.integrationDir, 'symbolic-ref', 'HEAD', userBranch);
            else git(run.integrationDir, 'reset', '--hard', nodeCommit);
            return passed();
        });
        assert.equal(result.outcome, 'verification_failed'); assert(existsSync(result.evidenceFile));
        assert.equal(git(input.repo, 'rev-parse', 'HEAD'), input.baseCommit);
        assert.equal(git(input.repo, 'status', '--porcelain'), '');
        assert.equal(git(input.repo, 'rev-parse', run.integrationRef), input.baseCommit);
    }
});
test('authorized integration alignment checks both heads and only updates its clean detached checkout', () => {
    const input = setup(); const run = createRunWorkspace(input); const node = createNodeWorkspace(run, 'node');
    const next = commit(node.dir, 'next.txt', 'Next\n');
    assert.throws(() => alignIntegration(run, input.baseCommit, next), /ref|head/i);
    git(input.repo, 'update-ref', run.integrationRef, next, input.baseCommit);
    assert.throws(() => alignIntegration(run, next, next), /head|base/i);
    writeFileSync(path.join(run.integrationDir, 'untracked.txt'), 'Preserve local work');
    assert.throws(() => alignIntegration(run, input.baseCommit, next), /change|clean/i);
    git(run.integrationDir, 'add', '.'); git(run.integrationDir, 'commit', '-qm', 'Preserved local work');
    const localHead = git(run.integrationDir, 'rev-parse', 'HEAD');
    alignIntegration(run, localHead, next);
    assert.equal(git(run.integrationDir, 'rev-parse', 'HEAD'), next);
    assert.equal(git(run.integrationDir, 'rev-parse', '--symbolic-full-name', 'HEAD'), 'HEAD');
    assert.equal(readFileSync(path.join(run.integrationDir, 'next.txt'), 'utf8'), 'Next\n');
    assert.equal(git(input.repo, 'rev-parse', 'HEAD'), input.baseCommit); assert.equal(git(input.repo, 'status', '--porcelain'), '');
    git(run.integrationDir, 'symbolic-ref', 'HEAD', git(input.repo, 'symbolic-ref', 'HEAD'));
    assert.throws(() => alignIntegration(run, input.baseCommit, next), /detached|head|change/i);
    assert.equal(git(input.repo, 'rev-parse', 'HEAD'), input.baseCommit);
});
test('failures after integration CAS require inspection and retain candidate verification evidence', async () => {
    for (const failure of ['reset', 'receipt']) {
        const input = setup(); const run = createRunWorkspace(input); const node = createNodeWorkspace(run, 'node');
        commit(node.dir, 'feature.txt', 'Feature\n');
        let confirmation!: LandingUncertainError['confirmation'];
        await assert.rejects(landNode(run, node, async candidate => {
            if (failure === 'reset') writeFileSync(git(run.integrationDir, 'rev-parse', '--git-path', 'index.lock'), 'Fixture stale lock');
            else writeFileSync(path.join(path.dirname(candidate.dir), 'landing.json'), 'Existing receipt must not be overwritten');
            return passed();
        }), (error: unknown) => {
            assert(error instanceof Error); assert.equal(error.name, 'LandingUncertainError');
            confirmation = (error as LandingUncertainError).confirmation;
            assert.equal(confirmation.baseCommit, input.baseCommit);
            assert.equal(git(input.repo, 'rev-parse', run.integrationRef), confirmation.candidateCommit);
            assert(existsSync(confirmation.candidateDir)); assert(existsSync(confirmation.verificationFile));
            assert.match(readFileSync(confirmation.verificationFile, 'utf8'), /verification passed/i);
            return true;
        });
        assert.equal(git(input.repo, 'rev-parse', 'HEAD'), input.baseCommit);
        assert.equal(git(input.repo, 'status', '--porcelain'), '');
        if (failure === 'receipt') assert.equal(readFileSync(confirmation.evidenceFile, 'utf8'), 'Existing receipt must not be overwritten');
    }
});
