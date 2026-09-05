import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type RunWorkspace = {
    workspaceDir: string; repo: string; root: string; runId: string; baseCommit: string;
    integrationRef: string; integrationDir: string;
};
export type NodeWorkspace = { runId: string; nodeId: string; dir: string; ref: string; baseCommit: string };
export type LandingCandidate = { repo: string; dir: string; baseCommit: string; nodeCommit: string };
export type LandingResult = {
    outcome: 'landed' | 'conflict' | 'verification_failed' | 'ref_drift';
    candidateDir: string; candidateCommit: string | null; baseCommit: string; nodeCommit: string;
    evidence: string; evidenceFile: string;
};
export class LandingUncertainError extends Error {
    override readonly name = 'LandingUncertainError';
    constructor(public readonly confirmation: {
        candidateDir: string; candidateCommit: string; baseCommit: string; nodeCommit: string;
        verificationFile: string; evidenceFile: string;
    }, cause: unknown) {
        super(`Integration ref advanced to ${confirmation.candidateCommit} from ${confirmation.baseCommit}, but confirmation failed. Inspect ${confirmation.candidateDir} and ${confirmation.verificationFile}; do not retry landing before inspection.`, { cause });
    }
}
type Verification = (candidate: LandingCandidate) => Promise<{ passed: boolean; evidence: string }>;
const queues = new Map<string, Promise<unknown>>();
const git = (repo: string, ...args: string[]) => execFileSync('git', args, {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
}).trim();
function identifier(value: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/.test(value)) throw Error('Invalid run or node identifier.');
    return value;
}
function directory(target: string) {
    const absolute = path.resolve(target);
    let current = path.parse(absolute).root;
    for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        const stat = lstatSync(current);
        if (stat.isSymbolicLink()) throw Error('Workspace path contains a symbolic link.');
        if (!stat.isDirectory()) throw Error('Workspace path is not a directory.');
    }
    return realpathSync(absolute);
}
function within(root: string, target: string) {
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('Path is outside declared workspace.');
}
function gitMetadata(workspace: string, repo: string, expectedCommon?: string) {
    if (lstatSync(path.join(repo, '.git')).isSymbolicLink()) throw Error('Git metadata contains a symbolic link.');
    const gitDir = directory(git(repo, 'rev-parse', '--path-format=absolute', '--git-dir'));
    const common = directory(git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
    within(workspace, gitDir); within(workspace, common);
    if (expectedCommon !== undefined && common !== expectedCommon) throw Error('Worktree Git metadata does not belong to its repository.');
    return common;
}
function integrationAt(run: RunWorkspace, expectedHead: string) {
    const common = gitMetadata(run.workspaceDir, run.repo);
    gitMetadata(run.workspaceDir, run.integrationDir, common);
    if (git(run.integrationDir, 'rev-parse', '--symbolic-full-name', 'HEAD') !== 'HEAD' ||
        git(run.integrationDir, 'rev-parse', 'HEAD') !== expectedHead)
        throw Error('Integration checkout must remain detached at the expected base HEAD.');
}
function ensureChild(parent: string, name: string) {
    directory(parent);
    const target = path.join(parent, name);
    try { mkdirSync(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return directory(target);
}
function readOwned<T>(file: string): T {
    directory(path.dirname(file));
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Ownership record is not a regular file.');
    return JSON.parse(readFileSync(file, 'utf8')) as T;
}
function writeNew(file: string, value: unknown) {
    directory(path.dirname(file));
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
function commit(repo: string, value: string) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw Error('An explicit commit object ID is required.');
    return git(repo, 'rev-parse', '--verify', '--end-of-options', `${value}^{commit}`);
}
function assertRun(run: RunWorkspace) {
    identifier(run.runId);
    const workspace = directory(run.workspaceDir); directory(run.repo); within(workspace, run.repo);
    const root = path.join(workspace, '.pops', 'runtime', 'plan-runs', run.runId);
    if (run.root !== root || run.integrationDir !== path.join(root, 'integration') ||
        run.integrationRef !== `refs/heads/pops/${run.runId}/integration`) throw Error('Run ownership does not match its declared paths.');
    const owner = readOwned<RunWorkspace>(path.join(root, 'ownership.json'));
    for (const key of Object.keys(run) as (keyof RunWorkspace)[]) if (owner[key] !== run[key]) throw Error('Run ownership record does not match.');
    directory(run.integrationDir);
    const common = gitMetadata(workspace, run.repo);
    gitMetadata(workspace, run.integrationDir, common);
}
function assertNode(run: RunWorkspace, node: NodeWorkspace) {
    identifier(node.nodeId);
    const parent = path.join(run.root, 'nodes', node.nodeId);
    const owner = readOwned<NodeWorkspace>(path.join(parent, 'ownership.json'));
    if (node.runId !== run.runId || node.dir !== path.join(parent, 'worktree') ||
        node.ref !== `refs/heads/pops/${run.runId}/nodes/${node.nodeId}` ||
        Object.keys(owner).some(key => owner[key as keyof NodeWorkspace] !== node[key as keyof NodeWorkspace])) throw Error('Node is not owned by this run.');
    directory(node.dir);
    gitMetadata(run.workspaceDir, node.dir, gitMetadata(run.workspaceDir, run.repo));
    if (git(node.dir, 'symbolic-ref', 'HEAD') !== node.ref) throw Error('Node worktree branch changed.');
}
function clean(dir: string) { return git(dir, 'status', '--porcelain') === ''; }
function addDetached(repo: string, dir: string, base: string) {
    directory(path.dirname(dir));
    try { lstatSync(dir); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { git(repo, 'worktree', 'add', '--detach', dir, base); return; }
        throw error;
    }
    throw Error('Worktree target already exists.');
}
export function createRunWorkspace(input: { workspaceDir: string; repo: string; runId: string; baseCommit: string }): RunWorkspace {
    const runId = identifier(input.runId); const workspaceDir = directory(input.workspaceDir); const repo = directory(input.repo);
    within(workspaceDir, repo); gitMetadata(workspaceDir, repo);
    if (git(repo, 'rev-parse', '--show-toplevel') !== repo) throw Error('Repository must be the registered Git root.');
    const baseCommit = commit(repo, input.baseCommit);
    const runtime = ensureChild(ensureChild(workspaceDir, '.pops'), 'runtime');
    const parent = ensureChild(runtime, 'plan-runs'); const root = path.join(parent, runId); mkdirSync(root);
    const run: RunWorkspace = { workspaceDir, repo, root, runId, baseCommit,
        integrationRef: `refs/heads/pops/${runId}/integration`, integrationDir: path.join(root, 'integration') };
    writeNew(path.join(root, 'ownership.json'), run);
    git(repo, 'update-ref', '--no-deref', run.integrationRef, baseCommit, '0'.repeat(baseCommit.length));
    addDetached(repo, run.integrationDir, baseCommit);
    mkdirSync(path.join(root, 'nodes')); mkdirSync(path.join(root, 'candidates'));
    return run;
}
export function createNodeWorkspace(run: RunWorkspace, nodeId: string, options: { baseCommit?: string } = {}): NodeWorkspace {
    assertRun(run); identifier(nodeId);
    const baseCommit = commit(run.repo, options.baseCommit ?? git(run.repo, 'rev-parse', run.integrationRef));
    const parent = path.join(run.root, 'nodes', nodeId); directory(path.dirname(parent)); mkdirSync(parent);
    const node: NodeWorkspace = { runId: run.runId, nodeId, baseCommit, dir: path.join(parent, 'worktree'), ref: `refs/heads/pops/${run.runId}/nodes/${nodeId}` };
    writeNew(path.join(parent, 'ownership.json'), node);
    git(run.repo, 'update-ref', '--no-deref', node.ref, baseCommit, '0'.repeat(baseCommit.length));
    git(run.repo, 'worktree', 'add', node.dir, node.ref.slice('refs/heads/'.length));
    return node;
}
function errorText(error: unknown) {
    const details = error as { stdout?: string; stderr?: string; message?: string };
    return [details.stdout, details.stderr, details.message].filter(Boolean).join('\n') || 'Operation failed.';
}
async function land(run: RunWorkspace, node: NodeWorkspace, verify: Verification): Promise<LandingResult> {
    assertRun(run); assertNode(run, node);
    if (!clean(node.dir)) throw Error('Node work must be committed before landing.');
    if (!clean(run.integrationDir)) throw Error('Integration worktree has uncommitted changes.');
    const baseCommit = git(run.repo, 'rev-parse', run.integrationRef); const nodeCommit = git(node.dir, 'rev-parse', 'HEAD');
    integrationAt(run, baseCommit);
    const parent = path.join(run.root, 'candidates', `${node.nodeId}-${randomUUID()}`); directory(path.dirname(parent)); mkdirSync(parent);
    const candidateDir = path.join(parent, 'worktree'); addDetached(run.repo, candidateDir, baseCommit);
    const evidenceFile = path.join(parent, 'landing.json');
    let candidateCommit: string | null = null;
    const result = (outcome: LandingResult['outcome'], evidence: string): LandingResult => {
        const value: LandingResult = { outcome, candidateDir, candidateCommit, baseCommit, nodeCommit, evidence, evidenceFile };
        writeNew(evidenceFile, value); return value;
    };
    try { git(candidateDir, 'merge', '--no-ff', '--no-edit', nodeCommit); }
    catch (error) { return result('conflict', errorText(error)); }
    candidateCommit = git(candidateDir, 'rev-parse', 'HEAD');
    let checked: Awaited<ReturnType<Verification>>;
    try { checked = await verify({ repo: run.repo, dir: candidateDir, baseCommit, nodeCommit }); }
    catch (error) { return result('verification_failed', errorText(error)); }
    if (!checked.passed || !checked.evidence?.trim()) return result('verification_failed', checked.evidence || 'Verification returned no evidence.');
    if (!clean(candidateDir) || git(candidateDir, 'rev-parse', 'HEAD') !== candidateCommit)
        return result('verification_failed', `${checked.evidence}\nVerification changed the candidate snapshot.`);
    if (!clean(run.integrationDir))
        return result('verification_failed', `${checked.evidence}\nIntegration worktree changed during verification.`);
    try { integrationAt(run, baseCommit); }
    catch (error) { return result('verification_failed', `${checked.evidence}\n${errorText(error)}`); }
    writeNew(path.join(parent, 'verification.json'), { baseCommit, nodeCommit, candidateCommit, ...checked });
    try { git(run.repo, 'update-ref', '--no-deref', run.integrationRef, candidateCommit, baseCommit); }
    catch (error) { return result('ref_drift', `${checked.evidence}\n${errorText(error)}`); }
    try {
        git(run.integrationDir, 'reset', '--hard', candidateCommit);
        return result('landed', checked.evidence);
    } catch (error) {
        throw new LandingUncertainError({ candidateDir, candidateCommit, baseCommit, nodeCommit,
            verificationFile: path.join(parent, 'verification.json'), evidenceFile }, error);
    }
}
export function landNode(run: RunWorkspace, node: NodeWorkspace, verify: Verification): Promise<LandingResult> {
    const previous = queues.get(run.root) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => land(run, node, verify));
    queues.set(run.root, current);
    void current.finally(() => { if (queues.get(run.root) === current) queues.delete(run.root); }).catch(() => {});
    return current;
}
export function cleanupNodeWorkspace(run: RunWorkspace, nodeId: string, options: { confirmed: boolean }) {
    if (!options.confirmed) throw Error('Worktree cleanup requires explicit confirmation.');
    assertRun(run); identifier(nodeId);
    const node = readOwned<NodeWorkspace>(path.join(run.root, 'nodes', nodeId, 'ownership.json')); assertNode(run, node);
    git(run.repo, 'worktree', 'remove', node.dir);
}

export function readNodeWorkspace(workspaceDir: string, repo: string, runId: string, nodeId: string) {
    identifier(runId); identifier(nodeId);
    const workspace = directory(workspaceDir);
    const run = readOwned<RunWorkspace>(path.join(workspace, '.pops', 'runtime', 'plan-runs', runId, 'ownership.json'));
    if (run.workspaceDir !== workspace || run.repo !== directory(repo) || run.runId !== runId) throw Error('Managed checkout does not belong to the registered repository.');
    assertRun(run);
    const node = readOwned<NodeWorkspace>(path.join(run.root, 'nodes', nodeId, 'ownership.json'));
    if (node.nodeId !== nodeId) throw Error('Managed node ownership does not match.');
    assertNode(run, node);
    return { run, node };
}

export function alignIntegration(run: RunWorkspace, expectedOldHead: string, newHead: string): void {
    assertRun(run);
    const oldCommit = commit(run.repo, expectedOldHead); const nextCommit = commit(run.repo, newHead);
    integrationAt(run, oldCommit);
    if (!clean(run.integrationDir)) throw Error('Integration alignment requires a clean checkout without local changes.');
    if (git(run.repo, 'rev-parse', run.integrationRef) !== nextCommit) throw Error('Integration ref changed after inspection.');
    git(run.integrationDir, 'reset', '--hard', nextCommit);
}
