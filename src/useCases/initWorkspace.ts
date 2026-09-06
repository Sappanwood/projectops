// Application use case: initialize a workspace shell.

import { lstatSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import { installSkill, SKILL_TARGET } from "../skills/skillInstall.js";
import type { CliIO } from "../io.js";
import { newWorkspaceManifest, workspaceRetrospectiveRoot } from "../catalog/workspace.js";
import { createRetrospectiveStore } from "../retrospective/retrospectiveFs.js";
import { createWorkspaceManifestFile, manifestPathFor } from "../catalog/workspaceStore.js";

export function initWorkspace(
  targetArg: string | undefined,
  json: boolean,
  io: CliIO,
  cwd: string,
  skipSkill = false,
  args: readonly string[] = [],
): number {
  const dir = path.resolve(cwd, targetArg ?? ".");
  const name = path.basename(dir) || "workspace";
  const manifest = newWorkspaceManifest(name);
  let manifestCreated = false;
  try {
    if (
      args.some((arg) => arg.startsWith("--") && !["--json", "--skip-skill"].includes(arg)) ||
      args.filter((arg) => !arg.startsWith("--")).length > 1
    )
      throw Error("Usage: pops init [dir] [--skip-skill] [--json]");
    mkdirSync(dir, { recursive: true });
    createWorkspaceManifestFile(dir, manifest);
    manifestCreated = true;
    createRetrospectiveStore(dir, workspaceRetrospectiveRoot(dir, manifest.retrospectives));
  } catch (error) {
    if (manifestCreated) removeCreatedManifest(dir);
    const message = error instanceof Error ? error.message : String(error);
    if (json) io.stdout(JSON.stringify({ ok: false, error: message }));
    else io.stderr(`Error: ${message}`);
    return 1;
  }
  const skill = skipSkill
    ? { status: "skipped", target: SKILL_TARGET }
    : installSkill(dir, "install");
  const ok = !["failed", "conflict"].includes(skill.status);
  const workspace = { name, manifest: ".pops/workspace.json", initialized: true };
  if (json) io.stdout(JSON.stringify({ ok, workspace, skill }));
  else {
    io.stdout(`Initialized workspace "${name}" at ${dir}; ProjectOps skill: ${skill.status}`);
    if (!ok && "recovery" in skill)
      io.stderr(`${skill.problems?.join("; ") ?? ""}\n${skill.recovery}`);
  }
  return ok ? 0 : 1;
}

function removeCreatedManifest(root: string): void {
  const file = manifestPathFor(root);
  try {
    const stat = lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink()) unlinkSync(file);
  } catch {
    // Best-effort cleanup preserves the original bootstrap diagnostic.
  }
}
