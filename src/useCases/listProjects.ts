// Application use case: list registered projects.

import type { CliIO } from "../io.js";
import { loadOrReport } from "./workspaceContext.js";

export function listProjects(json: boolean, io: CliIO, cwd: string): number {
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return 1;
  const { manifest } = workspace;

  const projects = Object.entries(manifest.projects).map(([id, registration]) => ({
    id,
    path: registration.path,
  }));

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
