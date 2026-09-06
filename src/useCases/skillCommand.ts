import { loadWorkspace } from "../catalog/workspaceStore.js";
import type { CliIO } from "../io.js";
import { installSkill, skillStatus, type SkillReceipt } from "../skills/skillInstall.js";

export function skillCommand(args: readonly string[], io: CliIO, cwd: string): number {
  const json = args.includes("--json");
  try {
    const [command, ...rest] = args.filter((arg) => arg !== "--json");
    let replace = false;
    let expected: string | undefined;
    for (let index = 0; index < rest.length; index++) {
      if (rest[index] === "--replace") replace = true;
      else if (rest[index] === "--expected-content" && rest[index + 1]) expected = rest[++index];
      else throw Error("Unknown skill option.");
    }
    if (
      !["install", "update", "status"].includes(command ?? "") ||
      ((replace || expected) && command !== "update") ||
      replace !== Boolean(expected)
    )
      throw Error(
        "Usage: pops skill install|status|update [--replace --expected-content <content_id>] [--json]",
      );
    const { root } = loadWorkspace(cwd);
    const skill: SkillReceipt =
      command === "status"
        ? skillStatus(root)
        : installSkill(root, command as "install" | "update", replace, expected);
    const ok = command === "status" || !["failed", "conflict"].includes(skill.status);
    if (json) io.stdout(JSON.stringify({ ok, skill }));
    else {
      io.stdout(
        `ProjectOps skill: ${skill.status} (${skill.target})${skill.distribution_id ? ` · ${skill.distribution_id}` : ""}`,
      );
      if (!ok || !skill.matches_cli)
        io.stdout(`${skill.problems?.join("; ") ?? ""}\n${skill.recovery ?? ""}`);
      if (skill.content_id) io.stdout(`content_id: ${skill.content_id}`);
      if (skill.backups?.length) io.stdout(`Backups: ${skill.backups.join(", ")}`);
    }
    return ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) io.stdout(JSON.stringify({ ok: false, error: message }));
    else io.stderr(message);
    return 1;
  }
}
