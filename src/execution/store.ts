import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadWorkspace } from '../catalog/workspaceStore.js';
import { isWithinWorkspace, projectArtifactRoots, resolveProjectPath } from '../catalog/workspace.js';
import { EXECUTION_SCHEMA, type ExecutionAttempt } from './attempt.js';
export class ExecutionError extends Error {
    constructor(public code: 'EXECUTION_INVALID' | 'EXECUTION_NOT_FOUND' | 'EXECUTION_CONFLICT' | 'RUNNER_UNAVAILABLE' | 'REVISION_MISMATCH', message: string) { super(message); }
}
export const id = () => `exe-${randomUUID()}`;
export function context(workspaceDir: string, projectId: string) {
    const w = loadWorkspace(workspaceDir);
    const p = w.manifest.projects[projectId];
    if (!Object.hasOwn(w.manifest.projects, projectId) || !p)
        throw new ExecutionError('EXECUTION_INVALID', 'Project is not registered.');
    if (w.manifest.artifact_layout.roots.executions !== EXECUTION_SCHEMA)
        throw new ExecutionError('EXECUTION_INVALID', 'Execution artifact descriptor is missing or invalid.');
    const roots = projectArtifactRoots(w.root, projectId, w.manifest.artifact_layout);
    if (!existsSync(roots.executions))
        throw new ExecutionError('EXECUTION_INVALID', 'Execution root is unavailable.');
    if (!isWithinWorkspace(realpathSync(w.root), realpathSync(roots.executions))) throw new ExecutionError('EXECUTION_INVALID', 'Execution root resolves outside workspace.');
    const repo = resolveProjectPath(w.root, p.path);
    if (!isWithinWorkspace(realpathSync(w.root), realpathSync(repo))) throw new ExecutionError('EXECUTION_INVALID', 'Repository resolves outside workspace.');
    return { workspace: w.root, root: roots.executions, backlog: roots.backlog, plans: roots.plans, repo: resolveProjectPath(w.root, p.path) };
}
export function readAttempt(root: string, attemptId: string, projectId?: string): ExecutionAttempt {
    if (!/^exe-[a-f0-9-]{36}$/.test(attemptId))
        throw new ExecutionError('EXECUTION_INVALID', 'Invalid attempt ID.');
    const file = path.join(root, `${attemptId}.json`);
    if (!existsSync(file))
        throw new ExecutionError('EXECUTION_NOT_FOUND', 'Attempt not found.');
    if (!isWithinWorkspace(realpathSync(root), realpathSync(file))) throw new ExecutionError('EXECUTION_INVALID', 'Attempt resolves outside execution root.');
    let a: ExecutionAttempt;
    try {
        a = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        throw new ExecutionError('EXECUTION_INVALID', 'Attempt JSON is unreadable.');
    }
    if (a.schema !== EXECUTION_SCHEMA || a.id !== attemptId || !Array.isArray(a.verifications) || !a.input?.item)
        throw new ExecutionError('EXECUTION_INVALID', 'Unsupported or invalid execution record.');
    if (!['running','stop_requested','unknown','succeeded','failed','stopped'].includes(a.state) ||
        typeof a.revision !== 'string' || !/^[a-f0-9]{16}$/.test(a.revision) ||
        typeof a.started_at !== 'string' || !Number.isFinite(Date.parse(a.started_at)) ||
        !['external','runtime'].includes(a.origin) || typeof a.project_id !== 'string' ||
        a.input.item.project !== a.project_id || a.input.item.id !== a.item_id ||
        (projectId !== undefined && a.project_id !== projectId) ||
        (a.acceptance !== null && (!a.acceptance || !['accepted','rework'].includes(a.acceptance.decision) ||
          typeof a.acceptance.note !== 'string' || typeof a.acceptance.at !== 'string' || !Number.isFinite(Date.parse(a.acceptance.at)))) ||
        a.verifications.some(v => !v || !['passed','failed'].includes(v.outcome) || typeof v.command !== 'string' ||
          typeof v.evidence_ref !== 'string' || typeof v.evidence_digest !== 'string' || !/^[a-f0-9]{64}$/.test(v.evidence_digest) || !v.snapshot?.digest))
        throw new ExecutionError('EXECUTION_INVALID', 'Execution scope or lifecycle data is invalid.');
    return a;
}
export function listAttempts(root: string, projectId?: string) { return readdirSync(root).filter(f => /^exe-.*\.json$/.test(f)).map(f => readAttempt(root, f.slice(0, -5), projectId)).sort((a, b) => a.started_at.localeCompare(b.started_at)); }
export function saveAttempt(root: string, a: ExecutionAttempt, create = false) {
    a.revision = createHash('sha256').update(JSON.stringify({ ...a, revision: '' })).digest('hex').slice(0, 16);
    writeFileSync(path.join(root, `${a.id}.json`), JSON.stringify(a, null, 2) + '\n', { flag: create ? 'wx' : 'w' });
    return a;
}
export function evidence(root: string, attemptId: string, body: string) {
    const dir = path.join(root, 'evidence');
    mkdirSync(dir, { recursive: true });
    if (!isWithinWorkspace(realpathSync(root), realpathSync(dir))) throw new ExecutionError('EXECUTION_INVALID', 'Evidence directory resolves outside execution root.');
    const ref = `evidence/${attemptId}-${randomUUID()}.txt`;
    writeFileSync(path.join(root, ref), body, { flag: 'wx' });
    return ref;
}
export function evidenceDigest(body: string) { return createHash('sha256').update(body).digest('hex'); }
export function evidenceReadable(root: string, ref: string, digest: string) {
    if (!/^evidence\/exe-[a-f0-9-]+\.txt$/.test(ref))
        return false;
    try {
        const file = path.join(root, ref);
        const body = readFileSync(file, 'utf8');
        return isWithinWorkspace(realpathSync(root), realpathSync(file)) && body.trim().length > 0 && evidenceDigest(body) === digest;
    }
    catch {
        return false;
    }
}

export function validateAcceptanceTargets(c: ReturnType<typeof context>, itemId: string) {
    const workspace = realpathSync(c.workspace);
    const backlog = realpathSync(c.backlog);
    const items = realpathSync(path.join(c.backlog, 'items'));
    const item = realpathSync(path.join(c.backlog, 'items', `${itemId}.md`));
    const index = realpathSync(path.join(c.backlog, 'INDEX.md'));
    if (!isWithinWorkspace(workspace, backlog) || !isWithinWorkspace(backlog, items) ||
        !isWithinWorkspace(items, item) || !isWithinWorkspace(backlog, index)) {
        throw new ExecutionError('EXECUTION_INVALID', 'Acceptance targets resolve outside their declared backlog store.');
    }
}
