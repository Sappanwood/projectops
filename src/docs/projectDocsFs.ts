// Filesystem adapter for the Project Docs domain.

import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PROJECT_DOC_TEMPLATES } from "./projectDocs.js";

export type ScaffoldReceipt = {
  created: string[];
  skipped: string[];
};

export type ProjectDocsProblem = {
  path: string;
  issue: string;
};

export class ProjectDocsScaffoldError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class ProjectDocsCheckError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type TargetState = {
  path: string;
  absolute: string;
  content: string;
  exists: boolean;
};

export function checkProjectDocs(workspaceRoot: string, projectDir: string): ProjectDocsProblem[] {
  const canonicalWorkspace = resolveExistingPathForCheck(workspaceRoot, "workspace root");
  const canonicalProject = resolveExistingPathForCheck(projectDir, "project path");
  ensureDirectoryForCheck(canonicalProject, "project path");
  ensureWithinForCheck(
    canonicalWorkspace,
    canonicalProject,
    "project path resolves outside the workspace",
  );

  const problems: ProjectDocsProblem[] = [];
  for (const template of PROJECT_DOC_TEMPLATES) {
    const absolute = path.join(canonicalProject, template.path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        problems.push({ path: template.path, issue: "document is missing" });
        continue;
      }
      problems.push({ path: template.path, issue: "document cannot be inspected" });
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      problems.push({ path: template.path, issue: "document is not a regular file" });
      continue;
    }
    let content: string;
    try {
      content = readFileSync(absolute, "utf8");
    } catch {
      problems.push({ path: template.path, issue: "document cannot be read" });
      continue;
    }
    if (!hasLevelOneHeading(content)) {
      problems.push({
        path: template.path,
        issue: "document is missing a level-one Markdown heading",
      });
    }
  }
  return problems;
}

export function scaffoldProjectDocs(workspaceRoot: string, projectDir: string): ScaffoldReceipt {
  const canonicalWorkspace = resolveExistingPath(workspaceRoot, "workspace root");
  const canonicalProject = resolveExistingPath(projectDir, "project path");
  ensureDirectory(canonicalProject, "project path");
  ensureWithin(canonicalWorkspace, canonicalProject, "project path resolves outside the workspace");

  const docsDir = path.join(canonicalProject, "docs");
  preflightDocsDirectory(canonicalWorkspace, canonicalProject, docsDir);

  const targets = PROJECT_DOC_TEMPLATES.map((template): TargetState => {
    const absolute = path.join(canonicalProject, template.path);
    return {
      path: template.path,
      absolute,
      content: template.content,
      exists: inspectTarget(absolute, template.path),
    };
  });

  if (targets.some((target) => !target.exists) && !pathExists(docsDir)) {
    try {
      mkdirSync(docsDir, { recursive: true });
    } catch (error) {
      throw new ProjectDocsScaffoldError(`cannot create docs directory: ${formatFsError(error)}`);
    }
  }

  const created: string[] = [];
  const skipped: string[] = [];
  for (const target of targets) {
    if (target.exists) {
      skipped.push(target.path);
      continue;
    }
    try {
      writeFileSync(target.absolute, target.content, { encoding: "utf8", flag: "wx" });
      created.push(target.path);
    } catch (error) {
      if (isErrno(error, "EEXIST")) {
        inspectTarget(target.absolute, target.path);
        skipped.push(target.path);
        continue;
      }
      throw new ProjectDocsScaffoldError(
        `cannot create ${target.path}: ${formatFsError(error)}`,
      );
    }
  }
  return { created, skipped };
}

function preflightDocsDirectory(
  canonicalWorkspace: string,
  canonicalProject: string,
  docsDir: string,
): void {
  let docsStat;
  try {
    docsStat = lstatSync(docsDir);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw new ProjectDocsScaffoldError(`cannot inspect docs directory: ${formatFsError(error)}`);
    }
    ensureWithin(
      canonicalWorkspace,
      path.resolve(canonicalProject, "docs"),
      "docs directory resolves outside the workspace",
    );
    ensureWithin(
      canonicalProject,
      path.resolve(canonicalProject, "docs"),
      "docs directory resolves outside the project",
    );
    return;
  }
  if (!docsStat.isDirectory() && !docsStat.isSymbolicLink()) {
    throw new ProjectDocsScaffoldError("docs path is not a directory");
  }
  const canonicalDocs = resolveExistingPath(docsDir, "docs directory");
  ensureWithin(canonicalWorkspace, canonicalDocs, "docs directory resolves outside the workspace");
  ensureWithin(canonicalProject, canonicalDocs, "docs directory resolves outside the project");
}

function inspectTarget(absolute: string, displayPath: string): boolean {
  try {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ProjectDocsScaffoldError(`${displayPath} is not a regular file`);
    }
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    if (error instanceof ProjectDocsScaffoldError) throw error;
    throw new ProjectDocsScaffoldError(`cannot inspect ${displayPath}: ${formatFsError(error)}`);
  }
}

function ensureDirectory(target: string, displayPath: string): void {
  try {
    if (!lstatSync(target).isDirectory()) {
      throw new ProjectDocsScaffoldError(`${displayPath} is not a directory`);
    }
  } catch (error) {
    if (error instanceof ProjectDocsScaffoldError) throw error;
    throw new ProjectDocsScaffoldError(`${displayPath} cannot be accessed: ${formatFsError(error)}`);
  }
}

function ensureDirectoryForCheck(target: string, displayPath: string): void {
  try {
    if (!lstatSync(target).isDirectory()) {
      throw new ProjectDocsCheckError(`${displayPath} is not a directory`);
    }
  } catch (error) {
    if (error instanceof ProjectDocsCheckError) throw error;
    throw new ProjectDocsCheckError(`${displayPath} cannot be accessed`);
  }
}

function resolveExistingPath(target: string, displayPath: string): string {
  try {
    return realpathSync(target);
  } catch (error) {
    throw new ProjectDocsScaffoldError(`${displayPath} cannot be resolved: ${formatFsError(error)}`);
  }
}

function resolveExistingPathForCheck(target: string, displayPath: string): string {
  try {
    return realpathSync(target);
  } catch {
    throw new ProjectDocsCheckError(`${displayPath} cannot be resolved`);
  }
}

function ensureWithin(base: string, target: string, message: string): void {
  const relative = path.relative(base, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProjectDocsScaffoldError(message);
  }
}

function ensureWithinForCheck(base: string, target: string, message: string): void {
  const relative = path.relative(base, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProjectDocsCheckError(message);
  }
}

export function hasLevelOneHeading(content: string): boolean {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (/^ {0,3}#(?:[ \t]+.*|[ \t]*)$/.test(line)) {
      return true;
    }
  }
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (current !== undefined && next !== undefined && current.trim() !== "" && /^ {0,3}=+[ \t]*$/.test(next)) {
      return true;
    }
  }
  return false;
}

function pathExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw new ProjectDocsScaffoldError(`cannot inspect docs directory: ${formatFsError(error)}`);
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function formatFsError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
