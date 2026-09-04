import { parseArgs } from "node:util";

import type { CliIO } from "../io.js";
import { triageRetrospective, type RetrospectiveTriageOptions } from "../retrospective/retrospectiveFs.js";
import { resolveRetrospectivesRoot } from "./retrospectiveContext.js";
import { formatRetrospectiveError, retrospectiveFailure, resolveRetrospectiveInput } from "./retrospectiveCli.js";
import { loadOrReport } from "./workspaceContext.js";

type TriageCliOptions = {
  to?: string;
  "expected-revision"?: string;
  disposition?: string;
  "owner-scope"?: string;
  owner?: string;
  category?: string[];
  categories?: string[];
  "next-action"?: string;
  "related-info"?: string[];
  related?: string[];
  canonical?: string;
};

export function retrospectiveTriage(args: string[], json: boolean, io: CliIO, cwd: string): number {
  const workspace = resolveRetrospectiveInput(io, json, (captured) => loadOrReport(cwd, captured));
  if (workspace === null) return 1;
  const root = resolveRetrospectiveInput(io, json, (captured) => resolveRetrospectivesRoot(captured, cwd, true));
  if (root === null) return 1;

  let values: TriageCliOptions & { positionals?: string[] };
  try {
    const parsed = parseArgs({
      args,
      options: {
        to: { type: "string" },
        "expected-revision": { type: "string" },
        disposition: { type: "string" },
        "owner-scope": { type: "string" },
        owner: { type: "string" },
        category: { type: "string", multiple: true },
        categories: { type: "string", multiple: true },
        "next-action": { type: "string" },
        "related-info": { type: "string", multiple: true },
        related: { type: "string", multiple: true },
        canonical: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    values = { ...parsed.values as TriageCliOptions, positionals: parsed.positionals };
  } catch {
    return retrospectiveFailure(io, json, "invalid arguments");
  }

  const reference = values.positionals?.[0];
  if (reference === undefined || values.positionals?.length !== 1) {
    return retrospectiveFailure(io, json, "Usage: pops retrospective triage <id> --to active|archive --expected-revision <revision> --disposition <value> --owner-scope <value> --next-action <value> [--category <value>] [--related-info <value>]");
  }
  const rawDisposition = values.disposition;
  if (rawDisposition === undefined || rawDisposition.trim() === "") {
    return retrospectiveFailure(io, json, "--disposition is required");
  }
  const destination = values.to;
  if (destination === undefined || destination.trim() === "") {
    return retrospectiveFailure(io, json, "--to is required and must be active or archive");
  }
  if (destination !== "active" && destination !== "archive") {
    return retrospectiveFailure(io, json, "--to must be active or archive");
  }
  const expectedRevision = values["expected-revision"];
  if (expectedRevision === undefined || expectedRevision.trim() === "") {
    return retrospectiveFailure(io, json, "--expected-revision is required");
  }
  const disposition = rawDisposition;
  const ownerScope = values["owner-scope"] ?? values.owner;
  if (ownerScope === undefined || ownerScope.trim() === "") {
    return retrospectiveFailure(io, json, "--owner-scope is required");
  }
  const nextAction = values["next-action"];
  if (nextAction === undefined || nextAction.trim() === "") {
    return retrospectiveFailure(io, json, "--next-action is required");
  }
  const categories = [...(values.category ?? []), ...(values.categories ?? [])];
  const relatedInfo = [...(values["related-info"] ?? []), ...(values.related ?? [])];
  if (categories.some((value) => value.trim() === "") || relatedInfo.some((value) => value.trim() === "")) {
    return retrospectiveFailure(io, json, "categories and related info must be non-empty");
  }

  const id = normalizeReference(reference);
  if (id === null) return retrospectiveFailure(io, json, "retrospective reference must be an id or inbox/<id>.md");
  const options: RetrospectiveTriageOptions = {
    destination,
    disposition,
    owner_scope: ownerScope,
    categories,
    related_info: relatedInfo,
    next_action: nextAction,
    ...(values.canonical === undefined ? {} : { canonical: values.canonical }),
  };
  try {
    const retrospective = triageRetrospective(workspace.root, root, id, expectedRevision, options);
    if (json) io.stdout(JSON.stringify({ ok: true, retrospective }));
    else io.stdout(`Triaged ${retrospective.id} to ${retrospective.status}`);
    return 0;
  } catch (error) {
    return retrospectiveFailure(io, json, formatRetrospectiveError(error));
  }
}

function normalizeReference(reference: string): string | null {
  const normalized = reference.endsWith(".md") ? reference.slice(0, -3) : reference;
  const parts = normalized.split("/");
  if (parts.length === 1) return parts[0] ?? null;
  if (parts.length === 2 && parts[0] === "inbox") return parts[1] ?? null;
  return null;
}
