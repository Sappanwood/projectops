import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repo = process.cwd();
test("packed CLI installs self-contained references and content-based updates at unchanged package version", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "pops-package-"));
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], {
      cwd: repo,
      encoding: "utf8",
    }),
  )[0];
  execFileSync("tar", ["xf", path.join(temp, packed.filename), "-C", temp]);
  const packageDir = path.join(temp, "package");
  assert.equal(existsSync(path.join(packageDir, "src")), false);
  const cli = path.join(packageDir, "dist/cli.js");
  const root = path.join(temp, "workspace");
  mkdirSync(root);
  const run = (...args: string[]) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args, "--json"], { cwd: root, encoding: "utf8" }),
    );
  const initial = run("init");
  const installed = path.join(root, ".agents/skills/projectops-workflow");
  const bundlePath = path.join(packageDir, "dist/skills/bundle.json");
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  const contract = bundle.files["references/AGENT_CONTRACT.md"];
  assert.match(contract, /backlog init mochi-write --id-prefix MWT/);
  assert.match(contract, /MOC2/);
  assert.match(contract, /backlog-init\.lock/);
  assert.match(bundle.files["SKILL.md"], /--id-prefix/);
  for (const [file, body] of Object.entries(bundle.files) as [string, string][]) {
    assert.doesNotMatch(body, /\/home\/ling|\.\.\/\.\.\/docs/);
    for (const link of body.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(link[1]!)) continue;
      const destination = path.resolve(installed, path.dirname(file), link[1]!.split("#")[0]!);
      assert.ok(destination.startsWith(installed + path.sep));
      assert.ok(readFileSync(destination, "utf8").length > 0, `${file}: ${link[1]}`);
    }
  }
  const version = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")).version;
  bundle.files["SKILL.md"] += "\n分发更新验证。\n";
  bundle.distribution_id = `sha256:${createHash("sha256").update(JSON.stringify(bundle.files)).digest("hex")}`;
  writeFileSync(bundlePath, JSON.stringify(bundle));
  assert.equal(run("skill", "status").skill.status, "outdated");
  const updated = run("skill", "update");
  assert.equal(updated.skill.status, "updated");
  assert.notEqual(updated.skill.distribution_id, initial.skill.distribution_id);
  assert.equal(
    JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")).version,
    version,
  );
  assert.equal(run("skill", "status").skill.matches_cli, true);
  assert.equal(run("skill", "update").skill.no_op, true);
  assert.ok(updated.skill.backups.length > 0);
  unlinkSync(path.join(installed, "references/runs.md"));
  const damaged = run("skill", "status").skill;
  assert.equal(damaged.status, "conflict");
  run("skill", "update", "--replace", "--expected-content", damaged.content_id);
  assert.equal(run("skill", "status").skill.matches_cli, true);
  assert.ok(readdirSync(installed).some((name) => name.startsWith(".projectops-backup-")));
  bundle.files["references/new.md"] = "new distributed reference";
  bundle.distribution_id = `sha256:${createHash("sha256").update(JSON.stringify(bundle.files)).digest("hex")}`;
  writeFileSync(bundlePath, JSON.stringify(bundle));
  writeFileSync(path.join(installed, "references/new.md"), "unmanaged user reference");
  assert.equal(run("skill", "status").skill.status, "conflict");
  assert.throws(() => run("skill", "update"));
  assert.equal(
    readFileSync(path.join(installed, "references/new.md"), "utf8"),
    "unmanaged user reference",
  );
});
