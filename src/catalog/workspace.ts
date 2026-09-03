// Catalog domain: workspace manifest schema and pure layout logic.

import path from "node:path";

export const WORKSPACE_SCHEMA = "workspace/Manifest@1";
export const MANIFEST_DIR = ".pops";
export const MANIFEST_FILE = "workspace.json";
export const OPS_ROOT = "ops";

export type ArtifactKey = "backlog" | "plans" | "reports" | "adr" | "research";

export type ArtifactLayout = {
  ops_root: string;
  roots: Record<ArtifactKey, string>;
};

export type ProjectRegistration = {
  path: string;
};

export type WorkspaceManifest = {
  schema: typeof WORKSPACE_SCHEMA;
  name: string;
  artifact_layout: ArtifactLayout;
  projects: Record<string, ProjectRegistration>;
};

export function newWorkspaceManifest(name: string): WorkspaceManifest {
  return {
    schema: WORKSPACE_SCHEMA,
    name,
    artifact_layout: {
      ops_root: OPS_ROOT,
      roots: {
        backlog: "backlog/store@1",
        plans: "markdown/plan@1",
        reports: "markdown/report@1",
        adr: "markdown/adr@1",
        research: "markdown/research@1",
      },
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
  const entries = (Object.keys(layout.roots) as ArtifactKey[]).map((key) => [
    key,
    path.join(base, key),
  ]);
  return Object.fromEntries(entries) as Record<ArtifactKey, string>;
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
