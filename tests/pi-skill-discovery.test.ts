import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DefaultResourceLoader,
  SettingsManager,
  createReadTool,
  createBashTool,
} from "@earendil-works/pi-coding-agent";

const cli = path.resolve("dist/cli.js");
test("managed Pi loader discovers workspace skill from registered Git repo and deeper cwd", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pops-pi-skill-"));
  const agentDir = mkdtempSync(path.join(tmpdir(), "pops-pi-agent-"));
  execFileSync(process.execPath, [cli, "init", "--json"], { cwd: root });
  const repo = path.join(root, "repo");
  mkdirSync(path.join(repo, "src/deep"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync(process.execPath, [cli, "project", "add", "repo", "--json"], { cwd: root });
  const runner = await import(new URL("../dist/execution/piRunner.js", import.meta.url).href);
  const createLoader = (
    runner as unknown as {
      createPiResourceLoader: (
        workspace: string,
        cwd: string,
        agent: string,
        settings: SettingsManager,
      ) => Promise<import("@earendil-works/pi-coding-agent").DefaultResourceLoader>;
    }
  ).createPiResourceLoader;
  assert.equal(typeof createLoader, "function");
  const baseline = new DefaultResourceLoader({
    cwd: repo,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await baseline.reload();
  assert.equal(
    baseline
      .getSkills()
      .skills.some(
        (skill) =>
          skill.filePath === path.join(root, ".agents/skills/projectops-workflow/SKILL.md"),
      ),
    false,
  );
  mkdirSync(path.join(agentDir, "skills/projectops-workflow"), { recursive: true });
  writeFileSync(
    path.join(agentDir, "skills/projectops-workflow/SKILL.md"),
    "---\nname: projectops-workflow\ndescription: Global collision fixture\n---\nGlobal fixture\n",
  );
  for (const cwd of [repo, path.join(repo, "src/deep"), root]) {
    const settings = SettingsManager.inMemory({
      skills: cwd === root ? [path.join(root, ".agents/skills/projectops-workflow")] : [],
    });
    const loader = await createLoader(root, cwd, agentDir, settings);
    const skills = loader
      .getSkills()
      .skills.filter((skill) => skill.name === "projectops-workflow");
    assert.equal(skills.length, 1);
    const skill = skills[0]!;
    assert.equal(skill.filePath, path.join(root, ".agents/skills/projectops-workflow/SKILL.md"));
    const reader = createReadTool(cwd);
    const loaded = await reader.execute("skill-read", { path: skill.filePath });
    const text = loaded.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const link = /\[Agent 操作契约\]\(([^)]+)\)/.exec(text)![1]!;
    const contract = await reader.execute("contract-read", {
      path: path.resolve(path.dirname(skill.filePath), link),
    });
    const contractText = contract.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    assert.match(contractText, /pops project list --json/);
    const shell = createBashTool(cwd);
    const result = await shell.execute("project-list", {
      command: `${quote(process.execPath)} ${quote(cli)} project list --json`,
    });
    const output = result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    assert.equal(JSON.parse(output).projects[0].id, "repo");
    console.log(
      JSON.stringify({
        cwd: path.relative(root, cwd),
        skill: path.relative(root, skill.filePath),
        operation: "project list",
        model_requests: 0,
      }),
    );
  }
});

function quote(arg: string): string {
  return "'" + arg.replaceAll("'", "'\\''") + "'";
}
