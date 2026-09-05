// Application use case: list registered projects.

import type { CliIO } from "../io.js";
import { getWorkspaceSummary } from "../application/workspaceApi.js";

export function listProjects(json: boolean, io: CliIO, cwd: string): number {
  const result = getWorkspaceSummary({ workspaceDir: cwd });
  if (!result.ok) {
    io.stderr(`Error: ${result.error.message}`);
    return 1;
  }
  const { projects } = result.data;

  if (json) {
    io.stdout(JSON.stringify({ ok: true, projects }));
  } else if (projects.length === 0) {
    io.stdout("No projects registered");
  } else {
    for (const project of projects) {
      io.stdout(`${project.id}\t${project.path}`);
    }
  }
  return 0;
}
