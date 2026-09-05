import { parseArgs } from "node:util";

import type { CliIO } from "../io.js";
import {
  archiveRetrospective,
  type RetrospectiveArchiveOptions,
} from "../retrospective/retrospectiveFs.js";
import { resolveRetrospectivesRoot } from "./retrospectiveContext.js";
import {
  formatRetrospectiveError,
  retrospectiveFailure,
  resolveRetrospectiveInput,
} from "./retrospectiveCli.js";
import { loadOrReport } from "./workspaceContext.js";

type ArchiveCliOptions = {
  "expected-revision"?: string;
  "action-disposition"?: string;
  "actioned-at"?: string;
  backlog?: string[];
  "backlog-link"?: string[];
  "resolution-note"?: string;
};

export function retrospectiveArchive(
  args: string[],
  json: boolean,
  io: CliIO,
  cwd: string,
): number {
  const workspace = resolveRetrospectiveInput(io, json, (captured) => loadOrReport(cwd, captured));
  if (workspace === null) return 1;
  const root = resolveRetrospectiveInput(io, json, (captured) =>
    resolveRetrospectivesRoot(captured, cwd, true),
  );
  if (root === null) return 1;

  let values: ArchiveCliOptions & { positionals?: string[] };
  try {
    const parsed = parseArgs({
      args,
      options: {
        "expected-revision": { type: "string" },
        "action-disposition": { type: "string" },
        "actioned-at": { type: "string" },
        backlog: { type: "string", multiple: true },
        "backlog-link": { type: "string", multiple: true },
        "resolution-note": { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    values = { ...(parsed.values as ArchiveCliOptions), positionals: parsed.positionals };
  } catch {
    return retrospectiveFailure(io, json, "invalid arguments");
  }

  const reference = values.positionals?.[0];
  if (reference === undefined || values.positionals?.length !== 1) {
    return retrospectiveFailure(
      io,
      json,
      "Usage: pops retrospective archive <id> --expected-revision <revision> --action-disposition <value> --resolution-note <note> [--actioned-at <timestamp>] [--backlog <logical-ref>]",
    );
  }
  const expectedRevision = values["expected-revision"];
  if (expectedRevision === undefined || expectedRevision.trim() === "") {
    return retrospectiveFailure(io, json, "--expected-revision is required");
  }
  const actionDisposition = values["action-disposition"];
  if (actionDisposition === undefined || actionDisposition.trim() === "") {
    return retrospectiveFailure(io, json, "--action-disposition is required");
  }
  const resolutionNote = values["resolution-note"];
  if (resolutionNote === undefined || resolutionNote.trim() === "") {
    return retrospectiveFailure(io, json, "--resolution-note is required");
  }
  const actionedAt = values["actioned-at"] ?? new Date().toISOString();
  if (actionedAt.trim() === "")
    return retrospectiveFailure(io, json, "--actioned-at must be a non-empty string");
  const backlog = [...(values.backlog ?? []), ...(values["backlog-link"] ?? [])];
  if (backlog.some((value) => value.trim() === ""))
    return retrospectiveFailure(io, json, "backlog links must be non-empty");
  const id = normalizeReference(reference);
  if (id === null)
    return retrospectiveFailure(
      io,
      json,
      "retrospective reference must be an id or active/<id>.md",
    );

  const options: RetrospectiveArchiveOptions = {
    action_disposition: actionDisposition,
    actioned_at: actionedAt,
    backlog,
    resolution_note: resolutionNote,
  };
  try {
    const retrospective = archiveRetrospective(workspace.root, root, id, expectedRevision, options);
    if (json) io.stdout(JSON.stringify({ ok: true, retrospective }));
    else io.stdout(`Archived ${retrospective.id}`);
    return 0;
  } catch (error) {
    return retrospectiveFailure(io, json, formatRetrospectiveError(error));
  }
}

function normalizeReference(reference: string): string | null {
  const normalized = reference.endsWith(".md") ? reference.slice(0, -3) : reference;
  const parts = normalized.split("/");
  if (parts.length === 1) return parts[0] ?? null;
  if (parts.length === 2 && parts[0] === "active") return parts[1] ?? null;
  return null;
}
