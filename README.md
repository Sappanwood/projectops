# ProjectOps

ProjectOps 是面向人类开发者和 Coding Agent 的本地 Project Operations 工具。它以可版本控制的
Markdown/JSON 文件为权威数据，计划统一管理项目注册表、Backlog、Plan、Delivery Report、项目文档体系和
Workflow Retrospective。

项目当前处于 Alpha 初始化阶段，以快速交付可运行的纵向工作流为主，不提供生产级安全、兼容性或完整边界保证。

## 快速开始

```bash
npm install
npm run dev -- --help
npm test
npm run typecheck
npm run build
node dist/cli.js --version
```

最终 CLI 名称为 `pops`。初始 npm package 保持 `private`，因为 npm registry 已存在同名的
`projectops` 和 `pops` package；公开发行名将在发布阶段另行决定。

## 当前能力

当前已可完成 workspace、project、Backlog 与 Plan 审批到 materialize 的基础工作流。

```bash
# 1. 在目标目录初始化 workspace 壳（目录可以非空，生成 .pops/workspace.json）
pops init ~/my-workspace

# 2. 显式登记一个目录为 project（workspace 的子路径，任意目录均可）
cd ~/my-workspace
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
pops backlog add my-app -T "First task" -c feature --priority P1 --body-file task.md
pops backlog list my-app --status todo
pops backlog show my-app APP-001
pops backlog update my-app APP-001 --status in_progress --expected-revision <revision>

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
```

- `pops --help`、`pops --version`
- `pops init`：workspace 壳初始化（不登记 repo）
- `pops project add/list/doctor`：显式登记、查询、拓扑校验
- `pops docs scaffold <project> [--json]`：为已登记 project 创建缺失的 README、AGENTS、产品规格和架构文档模板；已有普通文件只跳过，不覆盖
- `pops docs check <project> [--json]`：只读检查固定四份文档是否为普通文件并各自包含 Markdown 一级标题；失败时按固定顺序返回全部诊断
- `pops backlog init/add/list/show/update`：store bootstrap、CRUD、状态流转与 revision 保护
- `pops plan create/list/show/validate/approve/materialize`：从 JSON 草案创建、列出、查看、校验、批准并将已批准的 `plan/Plan@1` artifact 写入 Backlog；Plan ID 由 title 稳定生成，
  无 ASCII slug 的标题使用每个 Unicode code point 的 `u<hex>` token
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
