import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const files = {};
for (const name of ["SKILL.md", "references/runs.md", "references/validation.md"]) {
  files[name] = readFileSync(path.join(root, "skills/projectops-workflow", name), "utf8")
    .replaceAll("../../../docs/AGENT_CONTRACT.md", "AGENT_CONTRACT.md")
    .replaceAll("../../docs/AGENT_CONTRACT.md", "references/AGENT_CONTRACT.md");
}
const contract = readFileSync(path.join(root, "docs/AGENT_CONTRACT.md"), "utf8");
files["references/AGENT_CONTRACT.md"] =
  "# ProjectOps Agent 操作契约\n\n<!-- Generated from docs/AGENT_CONTRACT.md; edit the Repo source. -->\n\n" +
  contract.slice(contract.indexOf("## 选择 workspace 与入口"));
const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
const distribution = {
  schema: "projectops/SkillBundle@1",
  source: "projectops/skills/projectops-workflow",
  distribution_id: `sha256:${createHash("sha256").update(JSON.stringify(ordered)).digest("hex")}`,
  files: ordered,
};
mkdirSync(path.join(root, "dist/skills"), { recursive: true });
writeFileSync(
  path.join(root, "dist/skills/bundle.json"),
  JSON.stringify(distribution, null, 2) + "\n",
);
