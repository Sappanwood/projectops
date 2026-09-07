import { realpathSync, statSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { loadWorkspace } from "../catalog/workspaceStore.js";
import { devVariables, expandDevValue } from "../dev/config.js";

export type DevEndpoint = {
  project: string;
  endpoint: string;
  host: string;
  port: number;
  origin: string;
};
export type OwnedDevEndpoint = Pick<DevEndpoint, "project" | "endpoint" | "host" | "port">;
export type ResolvedDevProject = {
  project: string;
  repo: string;
  host: string;
  endpoints: DevEndpoint[];
  processes: { name: string; command: string[]; cwd: string; env: Record<string, string> }[];
};
export type DevProblem = { project: string; issue: string };
export type DevInspection = {
  ok: boolean;
  projects: ResolvedDevProject[];
  ports: DevEndpoint[];
  problems: DevProblem[];
};
function contained(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}
export function inspectDevConfiguration(workspaceDir: string): DevInspection {
  const { root, manifest } = loadWorkspace(workspaceDir);
  const projects: ResolvedDevProject[] = [];
  const ports: DevEndpoint[] = [];
  const problems: DevProblem[] = [];
  const assigned = new Map<number, string>();
  for (const [project, registration] of Object.entries(manifest.projects).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const dev = registration.dev;
    if (!dev) continue;
    const variables = devVariables(dev);
    const endpoints = Object.entries(dev.endpoints).map(([endpoint, value]) => ({
      project,
      endpoint,
      host: dev.host,
      port: value.port,
      origin: variables[`${endpoint.toUpperCase()}_ORIGIN`]!,
    }));
    for (const endpoint of endpoints) {
      const prior = assigned.get(endpoint.port);
      if (prior)
        problems.push({
          project,
          issue: `duplicate dev port ${endpoint.port}: ${prior} and ${project}/${endpoint.endpoint}`,
        });
      else assigned.set(endpoint.port, `${project}/${endpoint.endpoint}`);
      ports.push(endpoint);
    }
    try {
      const repo = realpathSync(path.resolve(root, registration.path));
      if (!contained(realpathSync(root), repo) || !statSync(repo).isDirectory())
        throw new Error("dev repo outside workspace or not a directory");
      const processes = Object.entries(dev.processes).map(([name, process]) => {
        const cwd = realpathSync(path.resolve(repo, process.cwd));
        if (!contained(repo, cwd) || !statSync(cwd).isDirectory())
          throw new Error(`dev cwd outside repo or not a directory: ${name}`);
        return {
          name,
          cwd,
          command: process.command.map((arg) => expandDevValue(arg, variables)),
          env: {
            ...variables,
            ...Object.fromEntries(
              Object.entries(process.env).map(([key, value]) => [
                key,
                expandDevValue(value, variables),
              ]),
            ),
          },
        };
      });
      projects.push({ project, repo, host: dev.host, endpoints, processes });
    } catch (error) {
      problems.push({ project, issue: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: problems.length === 0, projects, ports, problems };
}
export type DevPortCheck = DevEndpoint & {
  status: "free" | "managed" | "external" | "error";
  issue?: string;
};
export async function checkDevProject(
  workspaceDir: string,
  project: string,
  owned: readonly OwnedDevEndpoint[] = [],
): Promise<{
  ok: boolean;
  project: string;
  configuration: ResolvedDevProject | null;
  ports: DevPortCheck[];
  problems: DevProblem[];
}> {
  const inspection = inspectDevConfiguration(workspaceDir);
  const configuration = inspection.projects.find((p) => p.project === project) ?? null;
  const problems = [...inspection.problems];
  if (!configuration) problems.push({ project, issue: "project has no valid dev configuration" });
  const ports: DevPortCheck[] = [];
  if (configuration && problems.length === 0)
    for (const endpoint of configuration.endpoints) {
      if (
        owned.some(
          (p) =>
            p.project === project &&
            p.endpoint === endpoint.endpoint &&
            p.host === endpoint.host &&
            p.port === endpoint.port,
        )
      ) {
        ports.push({ ...endpoint, status: "managed" });
        continue;
      }
      const probe = await probeDevPort(endpoint);
      ports.push({ ...endpoint, ...probe });
      if (probe.status !== "free")
        problems.push({ project, issue: `${endpoint.endpoint}: ${probe.issue}` });
    }
  return { ok: problems.length === 0, project, configuration, ports, problems };
}
async function probeDevPort(
  endpoint: DevEndpoint,
): Promise<Pick<DevPortCheck, "status" | "issue">> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) =>
      resolve({
        status: error.code === "EADDRINUSE" ? "external" : "error",
        issue:
          error.code === "EADDRINUSE"
            ? `port ${endpoint.port} is externally occupied`
            : `port probe failed: ${error.code}`,
      }),
    );
    server.listen({ host: endpoint.host, port: endpoint.port, exclusive: true }, () =>
      server.close(() => resolve({ status: "free" })),
    );
  });
}
