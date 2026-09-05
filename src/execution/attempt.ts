import type { BacklogItem } from '../backlog/item.js';
export const EXECUTION_SCHEMA = 'execution/Attempt@1';
export type ExecutionState = 'running' | 'stop_requested' | 'unknown' | 'succeeded' | 'failed' | 'stopped';
export type CodeSnapshot = {
    head: string;
    digest: string;
    diff: string;
    files: string[];
};
export type Verification = {
    command: string;
    outcome: 'passed' | 'failed';
    at: string;
    snapshot: CodeSnapshot;
    evidence_ref: string;
    evidence_digest: string;
};
export type ExecutionAttempt = {
    schema: typeof EXECUTION_SCHEMA;
    id: string;
    execution_id: string;
    retry_of: string | null;
    project_id: string;
    item_id: string;
    task_ref: string;
    revision: string;
    origin: 'external' | 'runtime';
    input: {
        item: BacklogItem;
        instructions: string;
        plan: {
            ref: string;
            revision: string;
            snapshot: unknown;
        } | null;
    };
    started_at: string;
    ended_at: string | null;
    state: ExecutionState;
    summary: string;
    snapshot: CodeSnapshot | null;
    verifications: Verification[];
    acceptance: {
        decision: 'accepted' | 'rework';
        at: string;
        note: string;
        snapshot_digest: string | null;
    } | null;
};
export const activeStates: ExecutionState[] = ['running', 'stop_requested', 'unknown'];
