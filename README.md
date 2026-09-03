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

首个纵向闭环已可用：从初始化 workspace、登记 project 到 Backlog item 全生命周期。

```bash
# 1. 在空目录初始化 workspace 壳（生成 .pops/workspace.json）
pops init ~/my-workspace

# 2. 显式登记一个目录为 project（workspace 的子路径，任意目录均可）
cd ~/my-workspace
pops project add my-app

# 3. 查看注册表与拓扑健康
pops project list --json
pops project doctor

# 4. 为 project 初始化 backlog store
pops backlog init my-app

# 5. 创建与推进 backlog item
pops backlog add my-app -T "First task" -c feature --priority P1 --body-file task.md
pops backlog list my-app --status todo
pops backlog show my-app APP-001
pops backlog update my-app APP-001 --status in_progress --expected-revision <revision>
```

- `pops --help`、`pops --version`
- `pops init`：workspace 壳初始化（不登记 repo）
- `pops project add/list/doctor`：显式登记、查询、拓扑校验
- `pops backlog init/add/list/show/update`：store bootstrap、CRUD、状态流转与 revision 保护
- 数据全部为可读文件：workspace manifest 是 JSON，backlog item 是 frontmatter + Markdown body
- 单元测试、端到端 smoke、类型检查和构建

产品范围见 [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)，架构边界见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 关键行为约定

- workspace 是聚合父目录，project 必须是其子路径；workspace 根自身不可登记
- 登记不要求 git repo，任意目录都可以作为 project
- 重复登记同一目录报错；init 和 backlog init 不静默覆盖已有文件
- backlog update 支持 `--expected-revision` 防止覆盖并发修改
