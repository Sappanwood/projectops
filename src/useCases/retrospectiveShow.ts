import type { CliIO } from "../io.js";

import { showRetrospectiveRecord } from "../retrospective/retrospectiveFs.js";
import { resolveRetrospectivesRoot } from "./retrospectiveContext.js";
import { formatRetrospectiveError, retrospectiveFailure } from "./retrospectiveCli.js";
import { loadOrReport } from "./workspaceContext.js";

export function retrospectiveShow(
  reference: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  if (reference === undefined)
    return retrospectiveFailure(io, json, "Usage: pops retrospective show <id> [--json]");
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return 1;
  const root = resolveRetrospectivesRoot(io, cwd, true);
  if (root === null) return 1;
  try {
    const record = showRetrospectiveRecord(workspace.root, root, reference);
    if (json) io.stdout(JSON.stringify(record));
    else {
      const details = [
        `${record.id}  [${record.status}]`,
        `Project: ${record.project ?? "null"}`,
        `Task: ${record.task ?? "null"}`,
        `Revision: ${record.revision}`,
        "",
      ];
      if (record.body !== "") details.push(record.body);
      io.stdout(details.join("\n"));
    }
    return 0;
  } catch (error) {
    return retrospectiveFailure(io, json, formatRetrospectiveError(error));
  }
}
