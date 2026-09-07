import { createHash } from "node:crypto";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const SKILL_TARGET = ".agents/skills/projectops-workflow";
const RECORD = ".projectops-install.json";
const SOURCE = "projectops/skills/projectops-workflow";
type Distribution = {
  schema: string;
  source: string;
  distribution_id: string;
  files: Record<string, string>;
};
type Installation = {
  schema: string;
  source: string;
  distribution_id: string;
  files: Record<string, string>;
};
export type SkillReceipt = {
  status: string;
  target: string;
  distribution_id?: string;
  installed_id?: string | null;
  content_id?: string;
  matches_cli?: boolean;
  no_op?: boolean;
  problems?: string[];
  changed?: string[];
  backups?: string[];
  recovery?: string;
};
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

function safeName(name: string): boolean {
  return (
    !path.isAbsolute(name) &&
    name.split("/").every((part) => /^[\w.-]+$/.test(part) && part !== "." && part !== "..")
  );
}

export function skillDistribution(): Distribution {
  const bundle = JSON.parse(
    readFileSync(new URL("../../dist/skills/bundle.json", import.meta.url), "utf8"),
  ) as Distribution;
  if (
    bundle.schema !== "projectops/SkillBundle@1" ||
    bundle.source !== SOURCE ||
    !bundle.files ||
    typeof bundle.files !== "object" ||
    !bundle.files["SKILL.md"] ||
    Object.entries(bundle.files).some(
      ([name, value]) => !safeName(name) || name.startsWith(".") || typeof value !== "string",
    ) ||
    digest(JSON.stringify(bundle.files)) !== bundle.distribution_id
  )
    throw Error("Invalid packaged skill distribution; reinstall the CLI package.");
  return bundle;
}

function directories(root: string, relative: string, create = false): boolean {
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (create) {
      try {
        mkdirSync(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error(`Unsafe skill directory: ${path.relative(root, current)}`);
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }
  return true;
}

function read(root: string, name: string): string | null {
  if (!directories(root, path.dirname(name))) return null;
  try {
    const file = path.join(root, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Non-regular skill file: ${name}`);
    return readFileSync(file, "utf8");
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function inspect(root: string, bundle: Distribution) {
  const exists = directories(root, SKILL_TARGET);
  const target = path.join(root, SKILL_TARGET);
  const raw = exists ? read(target, RECORD) : null;
  let installed: Installation | null = null;
  if (raw !== null) {
    try {
      const value = JSON.parse(raw) as Installation;
      if (
        value.schema === "projectops/SkillInstallation@1" &&
        value.source === SOURCE &&
        typeof value.distribution_id === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(value.distribution_id) &&
        value.files &&
        typeof value.files === "object" &&
        typeof value.files["SKILL.md"] === "string" &&
        Object.entries(value.files).every(
          ([name, hash]) =>
            safeName(name) &&
            !name.startsWith(".") &&
            typeof hash === "string" &&
            /^sha256:[a-f0-9]{64}$/.test(hash),
        )
      )
        installed = value;
    } catch {
      /* Invalid records remain protected user content. */
    }
  }
  const files: Record<string, string | null> = {};
  for (const name of [
    ...new Set([...Object.keys(bundle.files), ...Object.keys(installed?.files ?? {}), RECORD]),
  ].sort()) {
    files[name] = exists ? read(target, name) : null;
  }
  const problems = installed
    ? Object.entries(installed.files)
        .filter(([name, hash]) => files[name] === null || digest(files[name]!) !== hash)
        .map(([name]) => name)
    : exists
      ? [raw === null ? "unmanaged installation" : "invalid installation record"]
      : [];
  if (installed) {
    for (const name of Object.keys(bundle.files)) {
      if (!(name in installed.files) && files[name] !== null)
        problems.push(`unmanaged file: ${name}`);
    }
  }
  const matches =
    installed?.distribution_id === bundle.distribution_id &&
    problems.length === 0 &&
    Object.entries(bundle.files).every(([name, body]) => files[name] === body);
  const receipt: SkillReceipt = {
    status: !exists ? "missing" : matches ? "current" : problems.length ? "conflict" : "outdated",
    target: SKILL_TARGET,
    distribution_id: bundle.distribution_id,
    installed_id: installed?.distribution_id ?? null,
    content_id: digest(JSON.stringify({ exists, files })),
    matches_cli: matches,
    problems,
    recovery:
      "Inspect with pops skill status --json. Use pops skill install if missing, or pops skill update for an intact installation. To replace damaged/unmanaged/local edits, review files then use pops skill update --replace --expected-content <content_id>. Backups are retained; do not repeat init.",
  };
  return { receipt, files, installed };
}

export function skillStatus(root: string): SkillReceipt {
  return inspect(root, skillDistribution()).receipt;
}

export function installSkill(
  root: string,
  mode: "install" | "update",
  replace = false,
  expected?: string,
): SkillReceipt {
  const changed: string[] = [];
  const backups: string[] = [];
  let locked = false;
  const lock = path.join(root, ".agents/skills/.projectops-workflow.lock");
  try {
    const bundle = skillDistribution();
    directories(root, ".agents/skills", true);
    try {
      mkdirSync(lock);
      locked = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST")
        throw Error(
          `Cannot create skill installer lock (${code ?? "unknown"}): ${error instanceof Error ? error.message : String(error)}. Check write permissions for .agents/skills; no lock ownership was acquired.`,
        );
      throw Error(
        "Skill installer lock already exists (EEXIST). Confirm no installer is running before removing the empty .agents/skills/.projectops-workflow.lock directory.",
      );
    }
    const before = inspect(root, bundle);
    if (replace && (!expected || expected !== before.receipt.content_id))
      throw Error("Replacement requires the current inspected --expected-content token.");
    if (before.receipt.matches_cli) return { ...before.receipt, no_op: true, changed, backups };
    if (before.receipt.status !== "missing" && mode === "install")
      return { ...before.receipt, status: "conflict", no_op: true, changed, backups };
    if (!replace && before.receipt.status === "conflict")
      return { ...before.receipt, no_op: true, changed, backups };
    directories(root, SKILL_TARGET, true);
    const target = path.join(root, SKILL_TARGET);
    const record: Installation = {
      schema: "projectops/SkillInstallation@1",
      source: SOURCE,
      distribution_id: bundle.distribution_id,
      files: Object.fromEntries(
        Object.entries(bundle.files).map(([name, body]) => [name, digest(body)]),
      ),
    };
    const desired = { ...bundle.files, [RECORD]: JSON.stringify(record, null, 2) + "\n" };
    for (const [name, body] of Object.entries(desired)) {
      const previous = before.files[name] ?? null;
      if (previous === body) continue;
      directories(root, `${SKILL_TARGET}/${path.dirname(name)}`, true);
      if (read(target, name) !== previous)
        throw Error(`Skill file changed during installation: ${name}`);
      const file = path.join(target, name);
      if (previous !== null) {
        const backupDir = mkdtempSync(path.join(target, ".projectops-backup-"));
        directories(backupDir, path.dirname(name), true);
        const backup = path.join(backupDir, name);
        renameSync(file, backup);
        backups.push(path.relative(root, backup));
        if (readFileSync(backup, "utf8") !== previous) {
          try {
            linkSync(backup, file);
          } catch {
            /* Preserve both versions if a writer claimed the target. */
          }
          throw Error(
            `Concurrent edit preserved in ${path.relative(root, backup)}; inspect before retry.`,
          );
        }
      }
      writeFileSync(file, body, { flag: "wx" });
      changed.push(name);
    }
    const after = inspect(root, bundle).receipt;
    if (!after.matches_cli)
      throw Error("Skill files changed before final verification; inspect before retry.");
    return {
      ...after,
      status: before.receipt.status === "missing" ? "installed" : "updated",
      no_op: false,
      changed,
      backups,
    };
  } catch (error) {
    return {
      status: "failed",
      target: SKILL_TARGET,
      no_op: changed.length === 0 && backups.length === 0,
      changed,
      backups,
      problems: [error instanceof Error ? error.message : String(error)],
      recovery:
        "Run pops skill status --json and inspect retained files/backups. Correct the reported path or lock problem, then retry skill install/update; damaged content needs reviewed --replace --expected-content. Do not repeat init.",
    };
  } finally {
    if (locked) rmdirSync(lock);
  }
}
