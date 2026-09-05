// CLI adapter: validate workspace topology.

import { inspectWorkspace } from "../application/workspaceInspection.js";
import type { CliIO } from "../io.js";
export type { WorkspaceProblem } from "../application/workspaceInspection.js";

export function doctorWorkspace(json: boolean, io: CliIO, cwd: string): number {
  const result = inspectWorkspace({ workspaceDir: cwd });
  if (!result.ok) {
    io.stderr(`Error: ${result.error.message}`);
    return 1;
  }
  const { healthy: ok, problems } = result.data;
  if (json) {
    io.stdout(JSON.stringify({ ok, problems }));
  } else if (ok) {
    io.stdout("Workspace is healthy");
  } else {
    for (const problem of problems) {
      io.stdout(`${problem.project}: ${problem.issue}`);
    }
  }
  return ok ? 0 : 1;
}
