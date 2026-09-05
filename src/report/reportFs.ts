// Filesystem adapter for Report Markdown artifacts.

import { lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseReport, serializeReport, isReportId, type Report } from "./report.js";

export class ReportNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Report not found: ${id}`);
  }
}

export class ReportAlreadyExistsError extends Error {
  constructor(public readonly id: string) {
    super(`Report already exists: ${id}`);
  }
}

export class ReportParseError extends Error {
  constructor(
    public readonly id: string,
    problem: string,
  ) {
    super(`Invalid report ${id}: ${problem}`);
  }
}

export class ReportRootError extends Error {
  constructor(
    public readonly root: string,
    problem: string,
  ) {
    super(`Invalid reports root ${root}: ${problem}`);
  }
}

export class ReportTargetError extends Error {
  constructor(
    public readonly target: string,
    problem: string,
  ) {
    super(`Invalid report target ${target}: ${problem}`);
  }
}

export function reportPath(root: string, id: string): string {
  if (!isReportId(id)) throw new ReportNotFoundError(id);
  return path.join(root, `${id}.md`);
}

export function listReportIds(workspaceRoot: string, reportsRoot: string): string[] {
  const root = validateReportsRoot(workspaceRoot, reportsRoot);
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (error) {
    throw new ReportRootError(root, `cannot read directory: ${formatFsError(error)}`);
  }
  return entries
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3))
    .filter(isReportId)
    .sort();
}

export function readReport(workspaceRoot: string, root: string, id: string): Report {
  const canonicalRoot = validateReportsRoot(workspaceRoot, root);
  const file = reportPath(canonicalRoot, id);
  ensureRegularTarget(file, id);
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new ReportNotFoundError(id);
    throw new ReportParseError(id, `cannot read file: ${formatFsError(error)}`);
  }
  const report = parseReport(content);
  if (typeof report === "string") throw new ReportParseError(id, report);
  if (report.id !== id) throw new ReportParseError(id, `id mismatch (contains ${report.id})`);
  return report;
}

export function writeReport(workspaceRoot: string, reportsRoot: string, report: Report): void {
  const canonicalRoot = validateReportsRoot(workspaceRoot, reportsRoot);
  const file = reportPath(canonicalRoot, report.id);
  if (targetExists(file)) ensureRegularTarget(file, report.id);
  try {
    writeFileSync(file, serializeReport(report), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isErrno(error, "EEXIST")) throw new ReportAlreadyExistsError(report.id);
    throw error;
  }
}

function validateReportsRoot(workspaceRoot: string, reportsRoot: string): string {
  const canonicalWorkspace = resolveExistingDirectory(workspaceRoot, "workspace");
  let rootStat;
  try {
    rootStat = lstatSync(reportsRoot);
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new ReportRootError(reportsRoot, "does not exist");
    throw new ReportRootError(reportsRoot, `cannot inspect: ${formatFsError(error)}`);
  }
  if (!rootStat.isDirectory() && !rootStat.isSymbolicLink()) {
    throw new ReportRootError(reportsRoot, "is not a directory");
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(reportsRoot);
  } catch (error) {
    throw new ReportRootError(reportsRoot, `cannot resolve: ${formatFsError(error)}`);
  }
  if (!isWithin(canonicalWorkspace, canonicalRoot)) {
    throw new ReportRootError(reportsRoot, "resolves outside the workspace");
  }
  let canonicalStat;
  try {
    canonicalStat = lstatSync(canonicalRoot);
  } catch (error) {
    throw new ReportRootError(
      reportsRoot,
      `cannot inspect resolved directory: ${formatFsError(error)}`,
    );
  }
  if (!canonicalStat.isDirectory()) throw new ReportRootError(reportsRoot, "is not a directory");
  return canonicalRoot;
}

function resolveExistingDirectory(target: string, displayPath: string): string {
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    throw new ReportRootError(target, `${displayPath} cannot be accessed: ${formatFsError(error)}`);
  }
  if (!stat.isDirectory()) throw new ReportRootError(target, `${displayPath} is not a directory`);
  try {
    return realpathSync(target);
  } catch (error) {
    throw new ReportRootError(target, `${displayPath} cannot be resolved: ${formatFsError(error)}`);
  }
}

function ensureRegularTarget(file: string, id: string): void {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new ReportNotFoundError(id);
    throw new ReportTargetError(file, `cannot inspect: ${formatFsError(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ReportTargetError(file, "is not a regular file");
  }
}

function targetExists(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw new ReportTargetError(file, `cannot inspect: ${formatFsError(error)}`);
  }
}

function isWithin(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function formatFsError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
