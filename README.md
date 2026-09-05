# ProjectOps

ProjectOps 是面向人类开发者和 Coding Agent 的本地 Project Operations 工具。它以可版本控制的
Markdown/JSON 文件为权威数据，计划统一管理项目注册表、Backlog、Plan、Delivery Report、项目文档体系和
Workflow Retrospective。

项目当前处于 Alpha 初始化阶段，以快速交付可运行的纵向工作流为主，不提供生产级安全、兼容性或完整边界保证。

## 快速开始

```bash
npm install
npm run build
npm link
pops --help
npm test
npm run typecheck
pops --version
```

这里的 `npm link` 会把当前仓库刚构建的 `dist/cli.js` 注册为本机的 `pops` 命令；开发时也可以直接使用
`npm run dev -- --help`。初始 npm package 保持 `private`，因为 npm registry 已存在同名的
`projectops` 和 `pops` package；公开发行名将在发布阶段另行决定。

Local Workbench server 通过显式 workspace 启动，默认只监听 `127.0.0.1:7331`：

```bash
npm run workbench -- --workspace "$HOME/my-workspace"
```

构建后 server 自动托管内置生产前端 Web 界面，浏览器访问 `http://127.0.0.1:7331` 即可体验。
选择 project 后进入 Backlog，可按状态浏览全部条目，选择条目查看 Markdown 正文、依赖和 revision，
并更新为 `todo`、`in_progress` 或 `done`。更新会刷新条目和项目摘要；revision 冲突时保留当前选择，
先点击 `Refresh item` 读取最新内容，再重新提交。未完成或缺失的依赖会显示提示；与 CLI 一样，
状态更新由用户显式决定，不自动推进依赖或强制改变状态。
Plans 和 Reports 页面可展开完整详情，分别查看审批、materialization mapping、item dependencies，以及
交付 outcome、Plan/Backlog references、验证、偏离、workaround 和正文。Docs 展示固定四份文档及
`docs check` 结果。Retrospectives 展示 workspace 完整列表，默认过滤当前项目；支持 status、project、task
精确过滤，project/task 留空表示全部，填写 `null` 表示 provenance 未记录。回顾按 inbox/active/archive 分组，
可展开 metadata 与正文；malformed artifact 单独显示诊断。这四个页面均只读，点击顶部 Refresh 重读文件。

开发者也可以增加 `--static-dir <path>` 覆盖静态资源目录。可选 `--host` 只接受
loopback 地址，`--port 0` 仅适合测试或一次性隔离运行。使用 `Ctrl-C` 或发送 `SIGTERM` 会关闭 listener。

## 当前能力

当前已可完成 workspace、project、Backlog、Plan 审批到 materialize、Delivery Report 生成与查询，以及 Workflow Retrospective 从捕获、查询到分类和归档的完整工作流；Local Workbench server 与前端壳已提供 workspace/project overview 和 Backlog、Plans、Reports、Docs、Retrospective 统一导航及 HTTP API。

```bash
# 1. 在目标目录初始化 workspace 壳（目录可以非空，生成 .pops/workspace.json）
pops init "$HOME/my-workspace"

# 2. 显式登记一个目录为 project（workspace 的子路径，任意目录均可）
cd "$HOME/my-workspace"
mkdir my-app
pops project add my-app

# 3. 查看注册表与拓扑健康
pops project list --json
pops project doctor

# 4. 为 project 补齐 Project Docs 长期文档入口
pops docs scaffold my-app --json
pops docs check my-app --json

# 5. 为 project 初始化 backlog store
pops backlog init my-app

# 6. 创建与推进 backlog item
pops backlog add my-app -T "First task" -c feature --priority P1 --body "First task body."
pops backlog list my-app --status todo
pops backlog show my-app MYA-001
revision="$(node -e 'const { readFileSync } = require("node:fs"); const text = readFileSync("ops/my-app/backlog/items/MYA-001.md", "utf8"); const match = /^revision: ([0-9a-f]+)$/m.exec(text); if (!match) process.exit(1); process.stdout.write(match[1]);')"
pops backlog update my-app MYA-001 --status in_progress --expected-revision "$revision"

# 7. 从显式 JSON 草案创建并查询 Plan
cat > release-plan.json <<'EOF'
{
  "title": "Release workflow",
  "goal": "Publish a repeatable release.",
  "items": [{
    "key": "prepare",
    "title": "Prepare release",
    "item_type": "task",
    "priority": "P1",
    "body": "Update release notes."
  }]
}
EOF
pops plan create my-app --input release-plan.json --json
pops plan list my-app --json
pops plan show my-app plan-release-workflow --json
pops plan validate my-app plan-release-workflow --json
pops plan approve my-app plan-release-workflow --review-note "Reviewed for release." --json
pops plan materialize my-app plan-release-workflow --json
pops backlog list my-app --json

# 8. 完成 materialized task 并生成 Delivery Report
plan_item_revision="$(node -e 'const { readFileSync } = require("node:fs"); const text = readFileSync("ops/my-app/backlog/items/MYA-002.md", "utf8"); const match = /^revision: ([0-9a-f]+)$/m.exec(text); if (!match) process.exit(1); process.stdout.write(match[1]);')"
pops backlog update my-app MYA-002 --status done --expected-revision "$plan_item_revision"
pops report create my-app plan-release-workflow --verification "npm test" --repo-doc "README.md" --json
pops report list my-app --json
pops report show my-app report-release-workflow --json

# 9. 完成 Workflow Retrospective 闭环（记录从 workspace 级 inbox 开始）
# `pops init` 已创建 `retrospectives/` store；capture 先写入 inbox，再按 revision 推进状态。
pops retrospective capture --trigger workflow-friction --harness codex-app --model null \
  --project my-app --task MYA-002 --body-file retrospective.md --json
pops retrospective list --status inbox --project my-app --json
pops retrospective show <retrospective-id> --json
pops retrospective triage <retrospective-id> --to active --expected-revision <revision> \
  --disposition actionable --owner-scope project --category tooling \
  --next-action "Improve the workflow." --json
pops retrospective archive <retrospective-id> --expected-revision <revision> \
  --action-disposition resolved --resolution-note "Handled." --json
```

`retrospective.md` 的正文必须包含三个非空 Markdown section（heading 可使用 1 至 6 级）：
`Hidden friction encountered`、`Workarounds used` 和 `Improvement candidates`。

每次成功的 triage/archive 都会更新 revision、移动唯一 Markdown authority，并重建
`retrospectives/index.json` 和 `retrospectives/INDEX.md`；过期 revision 或已有目标会失败且保留原记录。
capture 的显式和自动 ID 在三个状态目录中保持唯一；运行时锁位于
`.pops/runtime/retrospectives/`。Report 的 `--repo-doc` 使用 Repo 相对路径（如
`README.md`），archive 的 `--backlog` 使用
`project-ops:backlog/items/<PREFIX>-NNN.md`。

- `pops --help`、`pops --version`
- `pops init`：workspace 壳初始化（不登记 repo）
- `pops project add/list/doctor`：显式登记、查询、拓扑校验
- `pops docs scaffold <project> [--json]`：为已登记 project 创建缺失的 README、AGENTS、产品规格和架构文档模板；已有普通文件只跳过，不覆盖
- `pops docs check <project> [--json]`：只读检查固定四份文档是否为普通文件并各自包含 Markdown 一级标题；失败时按固定顺序返回全部诊断
- `pops backlog init/add/list/show/update`：store bootstrap、CRUD、状态流转与 revision 保护
- `pops plan create/list/show/validate/approve/materialize`：从 JSON 草案创建、列出、查看、校验、批准并将已批准的 `plan/Plan@1` artifact 写入 Backlog；Plan ID 由 title 稳定生成，
  无 ASCII slug 的标题使用每个 Unicode code point 的 `u<hex>` token
- `pops report create/list/show`：从已批准且 materialized 的 Plan 生成 completed 或显式 partial Delivery Report，并查询已生成的 Report；create 需要至少一条 `--verification`
- `pops retrospective capture/list/show`：将调用方提供的 trigger、harness、model、project/task provenance 和 Markdown 证据捕获到 workspace 级 inbox，并按 status/project/task 查询；capture 不自动分类或流转
- `pops retrospective triage <id>`：使用 `--expected-revision` 将 inbox 记录分类到 active 或直接 archive，并保存 disposition、owner scope、categories、next action 和 related info
- `pops retrospective archive <id>`：使用 `--expected-revision` 将 active 记录结案到 archive，并保存 action disposition、actioned_at、backlog links 和 resolution note；backlog link 必须使用 `project-ops:backlog/items/<PREFIX>-NNN.md`；两类流转均不覆盖既有目标，成功后重建派生索引
- 数据全部为可读文件：workspace manifest、Plan 是 JSON，backlog item 是 frontmatter + Markdown body
- 单元测试、端到端 smoke、类型检查和构建

产品范围见 [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)，架构边界见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 关键行为约定

- workspace 是聚合父目录，project 必须是其子路径；workspace 根自身不可登记
- 登记不要求 git repo，任意目录都可以作为 project
- init 可用于没有 workspace manifest 的非空目录，并保留既有内容
- 重复登记同一目录报错；init 和 backlog init 不静默覆盖已有文件
- Plan create 不覆盖相同 title 所生成的已存在 Plan
- docs scaffold 只写入已登记 project 的固定文档路径；目标为非普通文件或 docs 目录越界时失败，并在 JSON receipt 中返回 `created` 与 `skipped` 清单
- docs check 不写入 project 文件；缺失、非普通文件或缺少 Markdown 一级标题时返回非零，并在 `--json` 结果中返回稳定的 `problems` 诊断数组
- 只有校验通过的 draft Plan 才能通过 approve 记录一次批准，批准需要非空 review note
- 只有 approved Plan 才能 materialize；Plan 会保存每个局部 key 到 Backlog ID 的 `materialization.mapping`，重复执行完整 materialize 返回 `no_op`
- backlog update 支持 `--expected-revision` 防止覆盖并发修改
- Report create 从 materialized Plan 和同一 project 的 Backlog 读取实际状态；未完成 task 必须提供非空 `--partial-acceptance`，Report 文件不会覆盖既有文件
