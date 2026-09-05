import { parseArgs } from "node:util";

import type { CliIO } from "../io.js";
import {
  RETROSPECTIVE_STATUSES,
  type RetrospectiveStatus,
} from "../retrospective/retrospective.js";
import { listRetrospectiveRecords } from "../retrospective/retrospectiveFs.js";
import { resolveRetrospectivesRoot } from "./retrospectiveContext.js";
import { formatRetrospectiveError, retrospectiveFailure } from "./retrospectiveCli.js";
import { loadOrReport } from "./workspaceContext.js";

type ListOptions = { status?: string; project?: string; task?: string };

export function retrospectiveList(args: string[], json: boolean, io: CliIO, cwd: string): number {
  const workspace = loadOrReport(cwd, io);
  if (workspace === null) return 1;
  const root = resolveRetrospectivesRoot(io, cwd, true);
  if (root === null) return 1;
  let values: ListOptions;
  try {
    values = parseArgs({
      args,
      options: {
        status: { type: "string" },
        project: { type: "string" },
        task: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    }).values as ListOptions;
  } catch {
    return retrospectiveFailure(io, json, "invalid arguments");
  }
  let status: RetrospectiveStatus | undefined;
  if (values.status !== undefined) {
    if (!RETROSPECTIVE_STATUSES.includes(values.status as RetrospectiveStatus)) {
      return retrospectiveFailure(
        io,
        json,
        `--status must be one of: ${RETROSPECTIVE_STATUSES.join(", ")}`,
      );
    }
    status = values.status as RetrospectiveStatus;
  }
  try {
    const result = listRetrospectiveRecords(workspace.root, root, status);
    const project = filterValue(values.project);
    const task = filterValue(values.task);
    const records = result.records
      .filter((record) => project === undefined || record.project === project)
      .filter((record) => task === undefined || record.task === task)
      .map(({ body: _body, ...summary }) => summary);
    if (json) {
      const response: Record<string, unknown> = { ok: true, retrospectives: records };
      if (result.diagnostics.length > 0) response.diagnostics = result.diagnostics;
      io.stdout(JSON.stringify(response));
    } else if (records.length === 0) {
      io.stdout(
        result.diagnostics.length === 0
          ? "No retrospectives"
          : `No valid retrospectives (${result.diagnostics.length} diagnostic(s))`,
      );
    } else {
      for (const record of records)
        io.stdout(
          `${record.id}  [${record.status}]  ${record.project ?? "-"}  ${record.task ?? "-"}`,
        );
      if (result.diagnostics.length > 0) io.stdout(`Diagnostics: ${result.diagnostics.length}`);
    }
    return 0;
  } catch (error) {
    return retrospectiveFailure(io, json, formatRetrospectiveError(error));
  }
}

function filterValue(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === "null" ? null : value;
}
