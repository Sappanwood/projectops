// Filesystem adapter for the workspace-level Retrospective Markdown store.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
  type RetrospectiveIndex,
  type RetrospectiveIndexRecord,
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
  constructor(public readonly root: string, problem: unknown) {
    super(`Invalid retrospective store at ${root}: ${String(problem)}`);
  }
}

export class RetrospectiveRootError extends Error {
  constructor(public readonly root: string, problem: string) {
    super(`Invalid retrospectives root ${root}: ${problem}`);
  }
}

export class RetrospectiveTargetError extends Error {
  constructor(public readonly target: string, problem: string) {
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
  constructor(public readonly id: string, problem: string) {
    super(`Invalid retrospective ${id}: ${problem}`);
  }
}

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
    writeFileNoClobber(path.join(root, RETROSPECTIVE_STORE_MANIFEST_FILE), `${JSON.stringify(newRetrospectiveStoreManifest(), null, 2)}\n`);
    created.push(path.join(root, RETROSPECTIVE_STORE_MANIFEST_FILE));
    writeFileNoClobber(path.join(root, RETROSPECTIVE_INDEX_FILE), `${JSON.stringify(emptyIndex(), null, 2)}\n`);
    created.push(path.join(root, RETROSPECTIVE_INDEX_FILE));
    writeFileNoClobber(path.join(root, RETROSPECTIVE_READABLE_INDEX_FILE), renderReadableIndex(emptyIndex()));
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

export function loadRetrospectiveStore(storeRoot: string, workspaceRoot = path.dirname(storeRoot)): RetrospectiveStoreManifest {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  const manifestPath = path.join(root, RETROSPECTIVE_STORE_MANIFEST_FILE);
  ensureRegular(manifestPath, manifestPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new RetrospectiveStoreParseError(root, formatFsError(error));
  }
  if (!isRecord(parsed) || parsed.schema !== RETROSPECTIVE_STORE_SCHEMA ||
      parsed.record_schema !== RETROSPECTIVE_SCHEMA || parsed.index_schema !== RETROSPECTIVE_INDEX_SCHEMA) {
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

export function writeRetrospective(workspaceRoot: string, storeRoot: string, retrospective: Retrospective): void {
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

export function rebuildRetrospectiveIndexes(workspaceRoot: string, storeRoot: string): RetrospectiveIndex {
  const root = validateStoreLocation(workspaceRoot, storeRoot, false);
  loadRetrospectiveStore(root, workspaceRoot);
  const records: RetrospectiveIndexRecord[] = [];
  for (const status of RETROSPECTIVE_STATUSES) {
    for (const id of listRetrospectiveIds(workspaceRoot, root, status)) {
      const record = readRetrospective(workspaceRoot, root, status, id);
      records.push({
        id: record.id,
        created_at: record.created_at,
        project: record.project,
        task: record.task,
        trigger: record.trigger,
        status: record.status,
        harness: record.harness,
        model: record.model,
        path: `${status}/${id}.md`,
      });
    }
  }
  const index: RetrospectiveIndex = { schema: RETROSPECTIVE_INDEX_SCHEMA, records };
  writeDerived(root, RETROSPECTIVE_INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);
  writeDerived(root, RETROSPECTIVE_READABLE_INDEX_FILE, renderReadableIndex(index));
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
    lines.push(`| ${record.status} | ${record.id} | ${record.project} | ${record.task} | ${record.path} |`);
  }
  return `${lines.join("\n")}\n`;
}

function validateStoreLocation(workspaceRoot: string, storeRoot: string, allowMissing: boolean): string {
  const workspace = path.resolve(workspaceRoot);
  let workspaceCanonical: string;
  try {
    const stat = lstatSync(workspace);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("workspace is not a regular directory");
    workspaceCanonical = realpathSync(workspace);
  } catch (error) {
    throw new RetrospectiveRootError(workspace, `workspace cannot be resolved: ${formatFsError(error)}`);
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
    if (!stat.isDirectory()) throw new RetrospectiveRootError(root, "path component is not a directory");
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

function writeDerived(root: string, name: string, content: string): void {
  const file = path.join(root, name);
  if (targetExists(file)) ensureRegular(file, file);
  writeFileSync(file, content, { encoding: "utf8" });
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
  if (!stat.isFile() || stat.isSymbolicLink()) throw new RetrospectiveTargetError(display, "is not a regular file");
}

function ensureRegularDirectory(dir: string, display: string): void {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new RetrospectiveStoreNotFoundError(display);
    throw new RetrospectiveRootError(display, `cannot inspect: ${formatFsError(error)}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new RetrospectiveRootError(display, "is not a regular directory");
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
    if (!stat.isDirectory()) throw new RetrospectiveRootError(root, "path component is not a directory");
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
      throw new RetrospectiveRootError(displayRoot, `parent cannot be inspected: ${formatFsError(error)}`);
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
      throw new RetrospectiveRootError(displayRoot, `parent cannot be resolved: ${formatFsError(error)}`);
    }
  }
}
