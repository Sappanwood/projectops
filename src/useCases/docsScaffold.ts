// Application use case: scaffold the fixed Project Docs set for a registered project.

import type { CliIO } from "../io.js";
import { scaffoldProjectDocs, ProjectDocsScaffoldError } from "../docs/projectDocsFs.js";
import { resolveProjectPath } from "../catalog/workspace.js";
import { loadOrReport } from "./workspaceContext.js";

export function docsScaffold(
  projectId: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (projectId === undefined) {
    io.stderr("Usage: pops docs scaffold <project-id> [--json]");
    return 1;
  }
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return 1;
  const { root, manifest } = workspace;
  if (!Object.hasOwn(manifest.projects, projectId)) {
    io.stderr(`Error: project "${projectId}" is not registered`);
    return 1;
  }
  const registration = manifest.projects[projectId]!;

  const projectDir = resolveProjectPath(root, registration.path);
  let receipt;
  try {
    receipt = scaffoldProjectDocs(root, projectDir);
  } catch (error) {
    if (error instanceof ProjectDocsScaffoldError) {
      io.stderr(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  if (json) {
    io.stdout(JSON.stringify({ ok: true, project: projectId, ...receipt }));
  } else {
    const created = receipt.created.length;
    const skipped = receipt.skipped.length;
    io.stdout(`Scaffolded docs for "${projectId}" (created ${created}, skipped ${skipped})`);
  }
  return 0;
}
