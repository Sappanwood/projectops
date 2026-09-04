// Filesystem adapter for the Project Docs domain.

import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PROJECT_DOC_TEMPLATES } from "./projectDocs.js";

export type ScaffoldReceipt = {
  created: string[];
  skipped: string[];
};

export class ProjectDocsScaffoldError extends Error {
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

function resolveExistingPath(target: string, displayPath: string): string {
  try {
    return realpathSync(target);
  } catch (error) {
    throw new ProjectDocsScaffoldError(`${displayPath} cannot be resolved: ${formatFsError(error)}`);
  }
}

function ensureWithin(base: string, target: string, message: string): void {
  const relative = path.relative(base, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProjectDocsScaffoldError(message);
  }
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
