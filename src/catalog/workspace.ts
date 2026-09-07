// Catalog domain: workspace manifest schema and pure layout logic.

import path from "node:path";
import type { DevDescriptor } from "../dev/config.js";

export const WORKSPACE_SCHEMA = "workspace/Manifest@1";
export const MANIFEST_DIR = ".pops";
export const MANIFEST_FILE = "workspace.json";
export const OPS_ROOT = "ops";
export const RETROSPECTIVE_ARTIFACT_TYPE = "workflow/retrospectives@1";
export const RETROSPECTIVE_ROOT = "retrospectives";

export type ArtifactKey = "backlog" | "plans" | "reports" | "adr" | "research" | "executions";

export const ARTIFACT_TYPES: Record<ArtifactKey, string> = {
  backlog: "backlog/store@1",
  plans: "plan/Plan@1",
  reports: "markdown/report@1",
  adr: "markdown/adr@1",
  research: "markdown/research@1",
  executions: "execution/Attempt@1",
};

export const ARTIFACT_KEYS = Object.keys(ARTIFACT_TYPES) as ArtifactKey[];

export type ArtifactLayout = {
  ops_root: string;
  roots: Record<ArtifactKey, string>;
};

export type WorkspaceRetrospectives = {
  type: typeof RETROSPECTIVE_ARTIFACT_TYPE;
  root: string;
};

export type ProjectRegistration = {
  path: string;
  dev?: DevDescriptor;
};

export type WorkspaceManifest = {
  schema: typeof WORKSPACE_SCHEMA;
  name: string;
  artifact_layout: ArtifactLayout;
  retrospectives: WorkspaceRetrospectives;
  projects: Record<string, ProjectRegistration>;
};

export function newWorkspaceManifest(name: string): WorkspaceManifest {
  return {
    schema: WORKSPACE_SCHEMA,
    name,
    artifact_layout: {
      ops_root: OPS_ROOT,
      roots: { ...ARTIFACT_TYPES },
    },
    retrospectives: {
      type: RETROSPECTIVE_ARTIFACT_TYPE,
      root: RETROSPECTIVE_ROOT,
    },
    projects: {},
  };
}

export function projectOpsRoot(
  workspaceRoot: string,
  projectId: string,
  layout: ArtifactLayout,
): string {
  return path.join(workspaceRoot, layout.ops_root, projectId);
}

export function projectArtifactRoots(
  workspaceRoot: string,
  projectId: string,
  layout: ArtifactLayout,
): Record<ArtifactKey, string> {
  const base = projectOpsRoot(workspaceRoot, projectId, layout);
  const entries = ARTIFACT_KEYS.map((key) => [key, path.join(base, key)]);
  return Object.fromEntries(entries) as Record<ArtifactKey, string>;
}

export function workspaceRetrospectiveRoot(
  workspaceRoot: string,
  retrospectives: WorkspaceRetrospectives,
): string {
  return path.join(workspaceRoot, retrospectives.root);
}

export function slugifyProjectId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function isWithinWorkspace(workspaceRoot: string, target: string): boolean {
  const rel = path.relative(workspaceRoot, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function resolveProjectPath(workspaceRoot: string, registrationPath: string): string {
  return path.join(workspaceRoot, ...registrationPath.split("/"));
}

export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}
