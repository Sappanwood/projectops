// Application use case: check the fixed Project Docs set for a registered project.

import type { CliIO } from "../io.js";
import {
  checkProjectDocs,
  ProjectDocsCheckError,
} from "../docs/projectDocsFs.js";
import { resolveProjectPath } from "../catalog/workspace.js";
import { loadOrReport } from "./workspaceContext.js";

export function docsCheck(
  projectId: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined) {
    io.stderr("Usage: pops docs check <project-id> [--json]");
    return 1;
  }
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return 1;
  const { root, manifest } = workspace;
  const registration = manifest.projects[projectId];
  if (registration === undefined) {
    io.stderr(`Error: project "${projectId}" is not registered`);
    return 1;
  }

  const projectDir = resolveProjectPath(root, registration.path);
  let problems;
  try {
    problems = checkProjectDocs(root, projectDir);
  } catch (error) {
    if (error instanceof ProjectDocsCheckError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const ok = problems.length === 0;
  if (json) {
    io.stdout(JSON.stringify({ ok, project: projectId, problems }));
  } else if (ok) {
    io.stdout(`Project Docs are complete for "${projectId}"`);
  } else {
    for (const problem of problems) {
      io.stdout(`${problem.path}: ${problem.issue}`);
    }
  }
  return ok ? 0 : 1;
}
