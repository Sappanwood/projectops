// Filesystem adapter for the workspace-level Retrospective Markdown store.

import {
  existsSync,
  lstatSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  RETROSPECTIVE_INDEX_SCHEMA,
  RETROSPECTIVE_SCHEMA,
  RETROSPECTIVE_STATUSES,
  RETROSPECTIVE_STORE_SCHEMA,
  isRetrospectiveId,
  parseRetrospective,
  serializeRetrospective,
  type Retrospective,
  type RetrospectiveDiagnostic,
  type RetrospectiveIndex,
  type RetrospectiveIndexRecord,
  type RetrospectiveRecord,
  type RetrospectiveStatus,
  type RetrospectiveStoreManifest,
} from "./retrospective.js";

export const RETROSPECTIVE_STORE_MANIFEST_FILE = "retrospective.json";
export const RETROSPECTIVE_INDEX_FILE = "index.json";
export const RETROSPECTIVE_READABLE_INDEX_FILE = "INDEX.md";

export class RetrospectiveStoreAlreadyExistsError extends Error {
  constructor(public readonly root: string) {
    super(`Retrospective store already exists at ${root}`);
  }
}

export class RetrospectiveStoreNotFoundError extends Error {
  constructor(public readonly root: string) {
    super(`No retrospective store found at ${root}`);
  }
}

export class RetrospectiveStoreParseError extends Error {
  constructor(
    public readonly root: string,
    problem: unknown,
  ) {
    super(`Invalid retrospective store at ${root}: ${String(problem)}`);
  }
}

export class RetrospectiveRootError extends Error {
  constructor(
    public readonly root: string,
    problem: string,
  ) {
    super(`Invalid retrospectives root ${root}: ${problem}`);
  }
}

export class RetrospectiveTargetError extends Error {
  constructor(
    public readonly target: string,
    problem: string,
  ) {
    super(`Invalid retrospective target ${target}: ${problem}`);
  }
}

export class RetrospectiveNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Retrospective not found: ${id}`);
  }
}

export class RetrospectiveAlreadyExistsError extends Error {
  constructor(public readonly id: string) {
    super(`Retrospective already exists: ${id}`);
  }
}

export class RetrospectiveParseError extends Error {
  constructor(
    public readonly id: string,
    problem: string,
  ) {
    super(`Invalid retrospective ${id}: ${problem}`);
  }
}

export class RetrospectiveRevisionConflictError extends Error {
  constructor(
    public readonly id: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`Retrospective revision conflict for ${id}: expected ${expected}, current ${actual}`);
  }
}

export class RetrospectiveTransitionError extends Error {
  constructor(
    public readonly id: string,
    problem: string,
  ) {
    super(`Invalid retrospective transition for ${id}: ${problem}`);
  }
}

export type RetrospectiveTriageOptions = {
  destination: Extract<RetrospectiveStatus, "active" | "archive">;
  disposition: string;
  owner_scope: string;
  categories: string[];
  next_action: string;
  related_info: string[];
  canonical?: string;
};

export type RetrospectiveArchiveOptions = {
  action_disposition: string;
  actioned_at: string;
  backlog: string[];
  resolution_note: string;
};

export type RetrospectiveObserveWrite = (target: string, content: Buffer) => void;

export type RetrospectiveCaptureOptions = {
  generated?: boolean;
  /** Test-only low-level filesystem overrides. Production callers use the default adapter. */
  fsOps?: RetrospectiveFsOps;
};

export type RetrospectiveFsOps = {
  openSync?: typeof openSync;
  writeSync?: typeof writeSync;
  closeSync?: typeof closeSync;
  writeFileSync?: typeof writeFileSync;
  unlinkSync?: typeof unlinkSync;
};

type ResolvedRetrospectiveFsOps = {
  openSync: typeof openSync;
  writeSync: typeof writeSync;
  closeSync: typeof closeSync;
  writeFileSync: typeof writeFileSync;
  unlinkSync: typeof unlinkSync;
};

export const RETROSPECTIVE_RUNTIME_ROOT = path.join(".pops", "runtime", "retrospectives");
export const RETROSPECTIVE_LOCK_STALE_MS = 1_000;

export function newRetrospectiveStoreManifest(): RetrospectiveStoreManifest {
  return {
    schema: RETROSPECTIVE_STORE_SCHEMA,
    record_schema: RETROSPECTIVE_SCHEMA,
    index_schema: RETROSPECTIVE_INDEX_SCHEMA,
  };
}

export function createRetrospectiveStore(workspaceRoot: string, storeRoot: string): void {
  const root = validateStoreLocation(workspaceRoot, storeRoot, true);
  if (existsSync(root)) throw new RetrospectiveStoreAlreadyExistsError(root);

  const created = createDirectoryTree(root);
  try {
    for (const status of RETROSPECTIVE_STATUSES) {
      const dir = path.join(root, status);
      mkdirSync(dir);
      created.push(dir);
    }
    writeFileNoClobber(
      path.join(root, RETROSPECTIVE_STORE_MANIFEST_FILE),
      `${JSON.stringify(newRetrospectiveStoreManifest(), null, 2)}\n`,
    );
    created.push(path.join(root, RETROSPECTIVE_STORE_MANIFEST_FILE));
    writeFileNoClobber(
      path.join(root, RETROSPECTIVE_INDEX_FILE),
      `${JSON.stringify(emptyIndex(), null, 2)}\n`,
    );
    created.push(path.join(root, RETROSPECTIVE_INDEX_FILE));
    writeFileNoClobber(
      path.join(root, RETROSPECTIVE_READABLE_INDEX_FILE),
      renderReadableIndex(emptyIndex()),
    );
    created.push(path.join(root, RETROSPECTIVE_READABLE_INDEX_FILE));
  } catch (error) {
    for (const entry of created.reverse()) {
      try {
        if (lstatSync(entry).isDirectory()) rmdirSync(entry);
        else unlinkSync(entry);
      } catch {
        // Best-effort cleanup is sufficient for the trusted local Alpha store.
      }
    }
    throw error;
  }
}

export function loadRetrospectiveStore(
  storeRoot: string,
  workspaceRoot = path.dirname(storeRoot),
): RetrospectiveStoreManifest {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  const manifestPath = path.join(root, RETROSPECTIVE_STORE_MANIFEST_FILE);
  ensureRegular(manifestPath, manifestPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new RetrospectiveStoreParseError(root, formatFsError(error));
  }
  if (
    !isRecord(parsed) ||
    parsed.schema !== RETROSPECTIVE_STORE_SCHEMA ||
    parsed.record_schema !== RETROSPECTIVE_SCHEMA ||
    parsed.index_schema !== RETROSPECTIVE_INDEX_SCHEMA
  ) {
    throw new RetrospectiveStoreParseError(root, "unexpected schema");
  }
  for (const status of RETROSPECTIVE_STATUSES) {
    const dir = path.join(root, status);
    ensureRegularDirectory(dir, dir);
  }
  return parsed as RetrospectiveStoreManifest;
}

export function retrospectivePath(root: string, status: RetrospectiveStatus, id: string): string {
  if (!RETROSPECTIVE_STATUSES.includes(status) || !isRetrospectiveId(id)) {
    throw new RetrospectiveNotFoundError(id);
  }
  return path.join(root, status, `${id}.md`);
}

export function writeRetrospective(
  workspaceRoot: string,
  storeRoot: string,
  retrospective: Retrospective,
): void {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  loadRetrospectiveStore(root, workspaceRoot);
  const parsed = parseRetrospective(retrospective);
  if (typeof parsed === "string") throw new RetrospectiveParseError(retrospective.id, parsed);
  const dir = path.join(root, parsed.status);
  ensureRegularDirectory(dir, dir);
  const file = retrospectivePath(root, parsed.status, parsed.id);
  if (targetExists(file)) {
    ensureRegular(file, file);
    throw new RetrospectiveAlreadyExistsError(parsed.id);
  }
  try {
    writeFileSync(file, serializeRetrospective(parsed), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isErrno(error, "EEXIST")) throw new RetrospectiveAlreadyExistsError(parsed.id);
    throw new RetrospectiveTargetError(file, formatFsError(error));
  }
}

/**
 * Capture a new inbox record and refresh derived indexes as one application operation.
 * The record file and index snapshots are restored when publication fails.
 */
export function captureRetrospective(
  workspaceRoot: string,
  storeRoot: string,
  retrospective: Retrospective,
  observeWrite?: (target: string, content: Buffer) => void,
  options: RetrospectiveCaptureOptions = {},
): RetrospectiveRecord {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  loadRetrospectiveStore(root, workspaceRoot);
  const fsOps = resolveFsOps(options.fsOps);
  const release = acquireCaptureLock(workspaceRoot, root, fsOps);
  try {
    return captureRetrospectiveLocked(
      workspaceRoot,
      root,
      retrospective,
      observeWrite,
      options,
      fsOps,
    );
  } finally {
    release();
  }
}

function captureRetrospectiveLocked(
  workspaceRoot: string,
  root: string,
  retrospective: Retrospective,
  observeWrite?: (target: string, content: Buffer) => void,
  options: RetrospectiveCaptureOptions = {},
  fsOps: ResolvedRetrospectiveFsOps = resolveFsOps(),
): RetrospectiveRecord {
  const parsed = parseRetrospective(retrospective);
  if (typeof parsed === "string") throw new RetrospectiveParseError(retrospective.id, parsed);
  if (parsed.status !== "inbox")
    throw new RetrospectiveParseError(parsed.id, "capture records must use inbox status");

  const id = options.generated ? allocateGeneratedId(root, parsed.id) : parsed.id;
  if (allRetrospectiveIds(root).has(id)) throw new RetrospectiveAlreadyExistsError(id);
  const captured = id === parsed.id ? parsed : { ...parsed, id };
  const file = retrospectivePath(root, "inbox", captured.id);
  const indexFiles = [RETROSPECTIVE_INDEX_FILE, RETROSPECTIVE_READABLE_INDEX_FILE].map((name) => {
    const target = path.join(root, name);
    ensureRegular(target, target);
    return { target, content: readFileSync(target) };
  });
  const content = serializeRetrospective(captured);
  const intendedIndexes = new Map<string, Buffer>();
  let fileCreated = false;
  try {
    writeOwnedNewFile(file, Buffer.from(content, "utf8"), fsOps);
    fileCreated = true;
    observeWrite?.(file, Buffer.from(content, "utf8"));
    rebuildRetrospectiveIndexes(
      workspaceRoot,
      root,
      (target, intended) => {
        intendedIndexes.set(target, intended);
        observeWrite?.(target, intended);
      },
      fsOps,
    );
  } catch (error) {
    if (!fileCreated) {
      if (isErrno(error, "EEXIST")) throw new RetrospectiveAlreadyExistsError(captured.id);
      throw error;
    }
    try {
      removeCreatedFile(file, fsOps);
    } catch {
      // Best-effort rollback for the trusted local Alpha store.
    }
    for (const snapshot of indexFiles) {
      restoreDerivedSnapshot(snapshot.target, snapshot.content, fsOps);
    }
    throw error;
  }

  return {
    ...captured,
    path: `inbox/${captured.id}.md`,
    revision: revisionOf(content),
  };
}

/** Move an inbox record to active or archive with revision-protected triage metadata. */
export function triageRetrospective(
  workspaceRoot: string,
  storeRoot: string,
  id: string,
  expectedRevision: string,
  options: RetrospectiveTriageOptions,
  observeWrite?: RetrospectiveObserveWrite,
  fsOps?: RetrospectiveFsOps,
): RetrospectiveRecord {
  if (options.destination !== "active" && options.destination !== "archive") {
    throw new RetrospectiveTransitionError(id, "triage destination must be active or archive");
  }
  validateTriageOptions(id, options);
  return transitionRetrospective(
    workspaceRoot,
    storeRoot,
    id,
    "inbox",
    options.destination,
    expectedRevision,
    (record) => ({
      ...record,
      status: options.destination,
      disposition: options.disposition,
      owner_scope: options.owner_scope,
      categories: [...options.categories],
      next_action: options.next_action,
      related_info: [...options.related_info],
      ...(options.canonical === undefined ? {} : { canonical: options.canonical }),
    }),
    observeWrite,
    resolveFsOps(fsOps),
  );
}

/** Move an active record to archive with revision-protected resolution metadata. */
export function archiveRetrospective(
  workspaceRoot: string,
  storeRoot: string,
  id: string,
  expectedRevision: string,
  options: RetrospectiveArchiveOptions,
  observeWrite?: RetrospectiveObserveWrite,
  fsOps?: RetrospectiveFsOps,
): RetrospectiveRecord {
  validateArchiveOptions(id, options);
  return transitionRetrospective(
    workspaceRoot,
    storeRoot,
    id,
    "active",
    "archive",
    expectedRevision,
    (record) => ({
      ...record,
      status: "archive",
      action_disposition: options.action_disposition,
      actioned_at: options.actioned_at,
      backlog: [...options.backlog],
      resolution_note: options.resolution_note,
    }),
    observeWrite,
    resolveFsOps(fsOps),
  );
}

function transitionRetrospective(
  workspaceRoot: string,
  storeRoot: string,
  id: string,
  sourceStatus: Extract<RetrospectiveStatus, "inbox" | "active">,
  destination: Extract<RetrospectiveStatus, "active" | "archive">,
  expectedRevision: string,
  transform: (record: Retrospective) => Retrospective,
  observeWrite?: RetrospectiveObserveWrite,
  fsOps: ResolvedRetrospectiveFsOps = resolveFsOps(),
): RetrospectiveRecord {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  loadRetrospectiveStore(root, workspaceRoot);
  const release = acquireCaptureLock(workspaceRoot, root, fsOps);
  try {
    loadRetrospectiveStore(root, workspaceRoot);
    const sourceFile = retrospectivePath(root, sourceStatus, id);
    const destinationFile = retrospectivePath(root, destination, id);
    for (const status of RETROSPECTIVE_STATUSES) {
      if (status === sourceStatus) continue;
      const existingFile = retrospectivePath(root, status, id);
      if (!targetExists(existingFile)) continue;
      ensureRegular(existingFile, existingFile);
      if (status === destination) throw new RetrospectiveAlreadyExistsError(id);
      throw new RetrospectiveTransitionError(
        id,
        `records in ${status} cannot transition via this operation`,
      );
    }
    if (!targetExists(sourceFile)) {
      throw new RetrospectiveNotFoundError(id);
    }
    const source = readRecordFile(sourceFile, sourceStatus, id);
    if (source.revision !== expectedRevision) {
      throw new RetrospectiveRevisionConflictError(id, expectedRevision, source.revision);
    }
    if (targetExists(destinationFile)) {
      ensureRegular(destinationFile, destinationFile);
      throw new RetrospectiveAlreadyExistsError(id);
    }

    const indexSnapshots = [RETROSPECTIVE_INDEX_FILE, RETROSPECTIVE_READABLE_INDEX_FILE].map(
      (name) => {
        const target = path.join(root, name);
        ensureRegular(target, target);
        return { target, content: readFileSync(target) };
      },
    );
    const next = parseRetrospective(transform(source.record));
    if (typeof next === "string") throw new RetrospectiveParseError(id, next);
    const destinationContent = Buffer.from(serializeRetrospective(next), "utf8");
    const intendedIndexes = new Map<string, Buffer>();
    let destinationCreated = false;
    let sourceRemoved = false;
    try {
      writeOwnedNewFile(destinationFile, destinationContent, fsOps);
      destinationCreated = true;
      observeWrite?.(destinationFile, destinationContent);
      unlinkSync(sourceFile);
      sourceRemoved = true;
      rebuildRetrospectiveIndexes(workspaceRoot, root, (target, intended) => {
        intendedIndexes.set(target, intended);
        observeWrite?.(target, intended);
      });
    } catch (error) {
      try {
        if (sourceRemoved) restoreSourceFile(sourceFile, source.content, fsOps);
      } catch {
        // Preserve the original transition error; the source can be repaired by a later rebuild.
      }
      try {
        if (destinationCreated) removeCreatedDestination(destinationFile, fsOps);
      } catch {
        // Preserve the original transition error; the target can be diagnosed by the caller.
      }
      for (const snapshot of indexSnapshots) {
        restoreDerivedSnapshot(snapshot.target, snapshot.content, fsOps);
      }
      throw error;
    }

    return {
      ...next,
      path: `${destination}/${id}.md`,
      revision: revisionOf(destinationContent.toString("utf8")),
    };
  } finally {
    release();
  }
}

function readRecordFile(
  file: string,
  status: RetrospectiveStatus,
  id: string,
): { record: Retrospective; content: string; revision: string } {
  ensureRegular(file, file);
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    throw new RetrospectiveParseError(id, `cannot read file: ${formatFsError(error)}`);
  }
  const parsed = parseRetrospective(content);
  if (typeof parsed === "string") throw new RetrospectiveParseError(id, parsed);
  if (parsed.id !== id || parsed.status !== status) {
    throw new RetrospectiveParseError(id, "record id or status does not match its path");
  }
  return { record: parsed, content, revision: revisionOf(content) };
}

function validateTriageOptions(id: string, options: RetrospectiveTriageOptions): void {
  validateNonEmpty(id, "disposition", options.disposition);
  validateNonEmpty(id, "owner_scope", options.owner_scope);
  validateNonEmpty(id, "next_action", options.next_action);
  validateStringList(id, "categories", options.categories);
  validateStringList(id, "related_info", options.related_info);
}

function validateArchiveOptions(id: string, options: RetrospectiveArchiveOptions): void {
  validateNonEmpty(id, "action_disposition", options.action_disposition);
  validateNonEmpty(id, "actioned_at", options.actioned_at);
  validateNonEmpty(id, "resolution_note", options.resolution_note);
  validateStringList(id, "backlog", options.backlog);
  for (const reference of options.backlog) {
    if (!isCanonicalBacklogReference(reference)) {
      throw new RetrospectiveParseError(
        id,
        "backlog links must use project-ops:backlog/items/<PREFIX>-NNN.md logical references",
      );
    }
  }
}

function isCanonicalBacklogReference(value: string): boolean {
  return /^project-ops:backlog\/items\/[A-Z0-9]+-\d{3,}\.md$/.test(value);
}

function validateNonEmpty(id: string, field: string, value: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RetrospectiveParseError(id, `${field} must be a non-empty string`);
  }
}

function validateStringList(id: string, field: string, values: string[]): void {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string" || value.trim() === "")
  ) {
    throw new RetrospectiveParseError(id, `${field} must be an array of non-empty strings`);
  }
}

function restoreSourceFile(file: string, content: string, fsOps: ResolvedRetrospectiveFsOps): void {
  if (targetExists(file)) return;
  writeOwnedNewFile(file, Buffer.from(content, "utf8"), fsOps);
}

function removeCreatedDestination(file: string, fsOps: ResolvedRetrospectiveFsOps): void {
  try {
    removeCreatedFile(file, fsOps);
  } catch {
    // Preserve the original transition error; check/rebuild can diagnose leftovers.
  }
}

export type RetrospectiveReadResult = {
  records: RetrospectiveRecord[];
  diagnostics: RetrospectiveDiagnostic[];
};

/** Read all Markdown records without allowing one malformed file to crash the read model. */
export function listRetrospectiveRecords(
  workspaceRoot: string,
  storeRoot: string,
  status?: RetrospectiveStatus,
): RetrospectiveReadResult {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  loadRetrospectiveStore(root, workspaceRoot);
  const statuses = status === undefined ? RETROSPECTIVE_STATUSES : [status];
  const records: RetrospectiveRecord[] = [];
  const diagnostics: RetrospectiveDiagnostic[] = [];
  for (const currentStatus of statuses) {
    const directory = path.join(root, currentStatus);
    let entries: string[];
    try {
      entries = readdirSync(directory).sort();
    } catch (error) {
      throw new RetrospectiveRootError(directory, `cannot list directory: ${formatFsError(error)}`);
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const id = entry.slice(0, -3);
      const relativePath = `${currentStatus}/${entry}`;
      const file = path.join(directory, entry);
      try {
        ensureRegular(file, file);
        const content = readFileSync(file, "utf8");
        const parsed = parseRetrospective(content);
        if (typeof parsed === "string") {
          diagnostics.push({ id, path: relativePath, message: parsed });
          continue;
        }
        if (parsed.id !== id || parsed.status !== currentStatus) {
          diagnostics.push({
            id,
            path: relativePath,
            message: "record id or status does not match its path",
          });
          continue;
        }
        records.push({ ...parsed, path: relativePath, revision: revisionOf(content) });
      } catch (error) {
        diagnostics.push({
          id,
          path: relativePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  records.sort((left, right) => left.path.localeCompare(right.path));
  diagnostics.sort((left, right) => left.path.localeCompare(right.path));
  return { records, diagnostics };
}

export function showRetrospectiveRecord(
  workspaceRoot: string,
  storeRoot: string,
  reference: string,
): RetrospectiveRecord {
  const normalized = reference.endsWith(".md") ? reference : `${reference}.md`;
  const pathParts = normalized.split("/");
  let status: RetrospectiveStatus | undefined;
  let id: string | undefined;
  if (
    pathParts.length === 2 &&
    RETROSPECTIVE_STATUSES.includes(pathParts[0] as RetrospectiveStatus)
  ) {
    status = pathParts[0] as RetrospectiveStatus;
    id = pathParts[1]?.slice(0, -3);
  } else if (pathParts.length === 1) {
    id = pathParts[0]?.slice(0, -3);
  }
  if (id === undefined || !isRetrospectiveId(id)) throw new RetrospectiveNotFoundError(reference);
  const result = listRetrospectiveRecords(workspaceRoot, storeRoot, status);
  const record = result.records.find(
    (candidate) => candidate.id === id && (status === undefined || candidate.status === status),
  );
  if (record !== undefined) return record;
  const diagnostic = result.diagnostics.find((candidate) => candidate.id === id);
  if (diagnostic !== undefined) throw new RetrospectiveParseError(id, diagnostic.message);
  throw new RetrospectiveNotFoundError(reference);
}

export function listRetrospectiveIds(
  workspaceRoot: string,
  storeRoot: string,
  status: RetrospectiveStatus,
): string[] {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  loadRetrospectiveStore(root, workspaceRoot);
  const dir = path.join(root, status);
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md"))
    .map((entry) => entry.slice(0, -3))
    .filter(isRetrospectiveId)
    .sort();
}

export function readRetrospective(
  workspaceRoot: string,
  storeRoot: string,
  status: RetrospectiveStatus,
  id: string,
): Retrospective {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  loadRetrospectiveStore(root, workspaceRoot);
  const file = retrospectivePath(root, status, id);
  ensureRegular(file, file);
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    throw new RetrospectiveParseError(id, `cannot read file: ${formatFsError(error)}`);
  }
  const parsed = parseRetrospective(content);
  if (typeof parsed === "string") throw new RetrospectiveParseError(id, parsed);
  if (parsed.id !== id || parsed.status !== status) {
    throw new RetrospectiveParseError(id, "record id or status does not match its path");
  }
  return parsed;
}

export function rebuildRetrospectiveIndexes(
  workspaceRoot: string,
  storeRoot: string,
  observeWrite?: (target: string, content: Buffer) => void,
  fsOverrides?: RetrospectiveFsOps,
): RetrospectiveIndex {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  loadRetrospectiveStore(root, workspaceRoot);
  const fsOps = resolveFsOps(fsOverrides);
  const records: RetrospectiveIndexRecord[] = [];
  for (const status of RETROSPECTIVE_STATUSES) {
    for (const id of listRetrospectiveIds(workspaceRoot, root, status)) {
      const record = readRetrospective(workspaceRoot, root, status, id);
      const indexRecord: RetrospectiveIndexRecord = {
        id: record.id,
        created_at: record.created_at,
        project: record.project,
        task: record.task,
        trigger: record.trigger,
        status: record.status,
        harness: record.harness,
        model: record.model,
        path: `${status}/${id}.md`,
      };
      for (const field of [
        "disposition",
        "owner_scope",
        "categories",
        "next_action",
        "related_info",
        "canonical",
        "action_disposition",
        "actioned_at",
        "backlog",
        "resolution_note",
      ] as const) {
        if (record[field] !== undefined)
          (indexRecord as Record<string, unknown>)[field] = record[field];
      }
      records.push(indexRecord);
    }
  }
  const index: RetrospectiveIndex = { schema: RETROSPECTIVE_INDEX_SCHEMA, records };
  writeDerived(
    root,
    RETROSPECTIVE_INDEX_FILE,
    `${JSON.stringify(index, null, 2)}\n`,
    observeWrite,
    fsOps,
  );
  writeDerived(
    root,
    RETROSPECTIVE_READABLE_INDEX_FILE,
    renderReadableIndex(index),
    observeWrite,
    fsOps,
  );
  return index;
}

function emptyIndex(): RetrospectiveIndex {
  return { schema: RETROSPECTIVE_INDEX_SCHEMA, records: [] };
}

function renderReadableIndex(index: RetrospectiveIndex): string {
  const lines = [
    "# Retrospectives Index",
    "",
    "> Auto-generated from retrospective Markdown files.",
    `> Total records: ${index.records.length}`,
    "",
    "| Status | ID | Project | Task | Path |",
    "|---|---|---|---|---|",
  ];
  for (const record of index.records) {
    lines.push(
      `| ${record.status} | ${record.id} | ${record.project} | ${record.task} | ${record.path} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function validateStoreLocation(
  workspaceRoot: string,
  storeRoot: string,
  allowMissing: boolean,
): string {
  const workspace = path.resolve(workspaceRoot);
  let workspaceCanonical: string;
  try {
    const stat = lstatSync(workspace);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("workspace is not a regular directory");
    workspaceCanonical = realpathSync(workspace);
  } catch (error) {
    throw new RetrospectiveRootError(
      workspace,
      `workspace cannot be resolved: ${formatFsError(error)}`,
    );
  }

  const root = path.resolve(storeRoot);
  const relative = path.relative(workspace, root);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RetrospectiveRootError(root, "resolves outside the workspace");
  }
  let current = workspace;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isErrno(error, "ENOENT")) break;
      throw new RetrospectiveRootError(root, `cannot inspect path: ${formatFsError(error)}`);
    }
    if (stat.isSymbolicLink()) throw new RetrospectiveRootError(root, "path contains a symlink");
    if (!stat.isDirectory())
      throw new RetrospectiveRootError(root, "path component is not a directory");
  }

  if (!existsSync(root)) {
    if (!allowMissing) throw new RetrospectiveRootError(root, "does not exist");
    const canonicalParent = nearestExistingDirectory(path.dirname(root), root);
    if (!isWithinOrEqual(workspaceCanonical, canonicalParent)) {
      throw new RetrospectiveRootError(root, "parent resolves outside the workspace");
    }
    return root;
  }

  let stat;
  try {
    stat = lstatSync(root);
  } catch (error) {
    throw new RetrospectiveRootError(root, `cannot inspect: ${formatFsError(error)}`);
  }
  if (stat.isSymbolicLink()) throw new RetrospectiveRootError(root, "root is a symlink");
  if (!stat.isDirectory()) throw new RetrospectiveRootError(root, "root is not a directory");
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch (error) {
    throw new RetrospectiveRootError(root, `cannot resolve: ${formatFsError(error)}`);
  }
  if (!isWithin(workspaceCanonical, canonicalRoot)) {
    throw new RetrospectiveRootError(root, "resolves outside the workspace");
  }
  return root;
}

function writeFileNoClobber(file: string, content: string): void {
  writeFileSync(file, content, { encoding: "utf8", flag: "wx" });
}

function writeOwnedNewFile(file: string, content: Buffer, fsOps: ResolvedRetrospectiveFsOps): void {
  const existed = targetExists(file);
  try {
    fsOps.writeFileSync(file, content, { flag: "wx" });
  } catch (error) {
    if (!existed && targetExists(file)) {
      try {
        removeCreatedFile(file, fsOps);
      } catch {
        // Preserve the original write failure; a later diagnostic can inspect the target.
      }
    }
    throw error;
  }
}

function removeCreatedFile(file: string, fsOps: ResolvedRetrospectiveFsOps): void {
  ensureRegular(file, file);
  fsOps.unlinkSync(file);
}

function writeDerived(
  root: string,
  name: string,
  content: string,
  observeWrite?: (target: string, content: Buffer) => void,
  fsOps: ResolvedRetrospectiveFsOps = resolveFsOps(),
): void {
  const file = path.join(root, name);
  if (targetExists(file)) ensureRegular(file, file);
  const bytes = Buffer.from(content, "utf8");
  fsOps.writeFileSync(file, bytes);
  observeWrite?.(file, bytes);
}

function allocateGeneratedId(root: string, base: string): string {
  const existing = allRetrospectiveIds(root);
  if (!existing.has(base)) return base;
  let suffix = 2;
  for (;;) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
    suffix += 1;
  }
}

function allRetrospectiveIds(root: string): Set<string> {
  const ids = new Set<string>();
  for (const status of RETROSPECTIVE_STATUSES) {
    const directory = path.join(root, status);
    for (const entry of readdirSync(directory)) {
      if (entry.endsWith(".md")) ids.add(entry.slice(0, -3));
    }
  }
  return ids;
}

/** Restore a derived file from the operation snapshot while the store lock is held. */
function restoreDerivedSnapshot(
  target: string,
  snapshot: Buffer,
  fsOps: ResolvedRetrospectiveFsOps,
): void {
  try {
    ensureRegular(target, target);
    fsOps.writeFileSync(target, snapshot);
  } catch {
    // Preserve the original failure; check/rebuild can diagnose the store.
  }
}

/** Return the stable runtime lock path for a workspace retrospective store. */
export function retrospectiveLockPath(workspaceRoot: string, storeRoot: string): string {
  const workspace = path.resolve(workspaceRoot);
  const relativeStore = path.relative(workspace, path.resolve(storeRoot)).split(path.sep).join("/");
  const identity = createHash("sha256").update(relativeStore, "utf8").digest("hex").slice(0, 16);
  return path.join(workspace, RETROSPECTIVE_RUNTIME_ROOT, `store-${identity}.lock`);
}

/** Serialize capture and derived-index publication across concurrent local processes. */
function acquireCaptureLock(
  workspaceRoot: string,
  root: string,
  fsOps: ResolvedRetrospectiveFsOps,
): () => void {
  const target = retrospectiveLockPath(workspaceRoot, root);
  ensureRuntimeLockDirectory(workspaceRoot, path.dirname(target));
  for (let attempt = 0; attempt < 500; attempt += 1) {
    let descriptor: number | undefined;
    let lockCreated = false;
    try {
      descriptor = fsOps.openSync(target, "wx", 0o600);
      lockCreated = true;
      const content = Buffer.from(`${process.pid}\n`, "utf8");
      const written = fsOps.writeSync(descriptor, content, 0, content.byteLength, null);
      if (written !== content.byteLength)
        throw new Error("retrospective lock PID write was incomplete");
      fsOps.closeSync(descriptor);
      descriptor = undefined;
      return () => {
        try {
          ensureRegular(target, target);
          fsOps.unlinkSync(target);
        } catch {
          // Preserve the operation result; a stale lock is diagnosable by the caller.
        }
      };
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          fsOps.closeSync(descriptor);
        } catch {
          // Preserve the original lock acquisition failure.
        }
      }
      if (lockCreated) {
        try {
          ensureRegular(target, target);
          fsOps.unlinkSync(target);
        } catch {
          // Preserve the original lock acquisition failure.
        }
      }
      if (isErrno(error, "EEXIST")) {
        if (isStaleLock(target)) {
          try {
            fsOps.unlinkSync(target);
          } catch (cleanupError) {
            if (!isErrno(cleanupError, "ENOENT"))
              throw new RetrospectiveTargetError(target, formatFsError(cleanupError));
          }
          continue;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      throw new RetrospectiveTargetError(target, formatFsError(error));
    }
  }
  throw new RetrospectiveTargetError(target, "capture lock is busy");
}

function ensureRuntimeLockDirectory(workspaceRoot: string, target: string): void {
  const workspace = path.resolve(workspaceRoot);
  const runtime = path.resolve(target);
  const relative = path.relative(workspace, runtime);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RetrospectiveRootError(runtime, "runtime lock path resolves outside the workspace");
  }
  let current = workspace;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (!isErrno(error, "ENOENT"))
        throw new RetrospectiveTargetError(current, formatFsError(error));
      try {
        mkdirSync(current);
      } catch (mkdirError) {
        if (!isErrno(mkdirError, "EEXIST"))
          throw new RetrospectiveTargetError(current, formatFsError(mkdirError));
        try {
          stat = lstatSync(current);
        } catch (inspectError) {
          throw new RetrospectiveTargetError(current, formatFsError(inspectError));
        }
      }
      if (stat === undefined) continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new RetrospectiveRootError(
        current,
        "runtime lock path contains a non-regular directory",
      );
    }
  }
}

function isStaleLock(target: string): boolean {
  try {
    ensureRegular(target, target);
  } catch (error) {
    if (error instanceof RetrospectiveStoreNotFoundError) return true;
    throw error;
  }
  let lockStat;
  try {
    lockStat = lstatSync(target);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return true;
    throw new RetrospectiveTargetError(target, formatFsError(error));
  }
  let pid: number;
  let content: string;
  try {
    content = readFileSync(target, "utf8").trim();
    pid = Number.parseInt(content, 10);
  } catch {
    return Date.now() - lockStat.mtimeMs > RETROSPECTIVE_LOCK_STALE_MS;
  }
  if (!Number.isSafeInteger(pid) || pid <= 0 || String(pid) !== content) {
    return Date.now() - lockStat.mtimeMs > RETROSPECTIVE_LOCK_STALE_MS;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return isErrno(error, "ESRCH");
  }
}

function resolveFsOps(overrides: RetrospectiveFsOps = {}): ResolvedRetrospectiveFsOps {
  return {
    openSync: overrides.openSync ?? openSync,
    writeSync: overrides.writeSync ?? writeSync,
    closeSync: overrides.closeSync ?? closeSync,
    writeFileSync: overrides.writeFileSync ?? writeFileSync,
    unlinkSync: overrides.unlinkSync ?? unlinkSync,
  };
}

function targetExists(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw new RetrospectiveTargetError(file, `cannot inspect: ${formatFsError(error)}`);
  }
}

function ensureRegular(file: string, display: string): void {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new RetrospectiveStoreNotFoundError(display);
    throw new RetrospectiveTargetError(display, `cannot inspect: ${formatFsError(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new RetrospectiveTargetError(display, "is not a regular file");
}

function ensureRegularDirectory(dir: string, display: string): void {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new RetrospectiveStoreNotFoundError(display);
    throw new RetrospectiveRootError(display, `cannot inspect: ${formatFsError(error)}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new RetrospectiveRootError(display, "is not a regular directory");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isWithinOrEqual(base: string, target: string): boolean {
  return base === target || isWithin(base, target);
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function formatFsError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function revisionOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function createDirectoryTree(root: string): string[] {
  const missing: string[] = [];
  let current = root;
  for (;;) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        const parent = path.dirname(current);
        if (parent === current) {
          throw new RetrospectiveRootError(root, "parent cannot be resolved");
        }
        missing.push(current);
        current = parent;
        continue;
      }
      throw new RetrospectiveRootError(root, `cannot inspect path: ${formatFsError(error)}`);
    }
    if (stat.isSymbolicLink()) throw new RetrospectiveRootError(root, "path contains a symlink");
    if (!stat.isDirectory())
      throw new RetrospectiveRootError(root, "path component is not a directory");
    break;
  }

  const created: string[] = [];
  try {
    for (const directory of missing.reverse()) {
      mkdirSync(directory);
      created.push(directory);
    }
    return created;
  } catch (error) {
    for (const directory of created.reverse()) {
      try {
        rmdirSync(directory);
      } catch {
        // Best-effort cleanup is sufficient for the trusted local Alpha store.
      }
    }
    throw error;
  }
}

function nearestExistingDirectory(target: string, displayRoot: string): string {
  let current = target;
  for (;;) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        const parent = path.dirname(current);
        if (parent === current) {
          throw new RetrospectiveRootError(displayRoot, "parent cannot be resolved");
        }
        current = parent;
        continue;
      }
      throw new RetrospectiveRootError(
        displayRoot,
        `parent cannot be inspected: ${formatFsError(error)}`,
      );
    }
    if (stat.isSymbolicLink()) {
      throw new RetrospectiveRootError(displayRoot, "parent path contains a symlink");
    }
    if (!stat.isDirectory()) {
      throw new RetrospectiveRootError(displayRoot, "parent path component is not a directory");
    }
    try {
      return realpathSync(current);
    } catch (error) {
      throw new RetrospectiveRootError(
        displayRoot,
        `parent cannot be resolved: ${formatFsError(error)}`,
      );
    }
  }
}
