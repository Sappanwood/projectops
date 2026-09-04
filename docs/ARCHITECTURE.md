# ProjectOps 架构

## 架构概览

ProjectOps 采用 TypeScript/Node.js 单运行时 modular monolith。CLI、Local Web Workbench 和未来 Agent 接口
共享 application/domain implementation；模块间不通过 CLI subprocess 通信。

```mermaid
flowchart TD
    CLI[pops CLI] --> App[Application Use Cases]
    Web[Local Web Workbench] --> App
    App --> Catalog[Catalog Domain]
    App --> Backlog[Backlog Domain]
    App --> Plan[Plan Domain]
    App --> Report[Report Domain]
    App --> Docs[Project Docs Domain]
    App --> Retro[Retrospective Domain]
    Catalog --> FS[Filesystem Adapters]
    Backlog --> FS
    Plan --> FS
    Report --> FS
    Docs --> FS
    Retro --> FS
    App --> ReadModel[Unified Read Model]
    ReadModel --> Web
```

当前 Repo 已落地 Workspace/Catalog、Backlog、Plan authoring/query/validation/approval/materialization、Project Docs
scaffold/check，以及 Report@1 schema、Markdown filesystem adapter、单 Plan Report 生成资格校验和
`pops report create/list/show`；Retrospective、Workbench 仍是目标域，上图是新增纵向能力时必须保持的目标依赖方向。

## 核心技术栈

| 层 | 技术 | 当前选择理由 |
|---|---|---|
| Runtime | Node.js 22+ | CLI、server 和构建使用单运行时 |
| Language | TypeScript | 共享 domain、application、CLI 和 Web contract |
| Package manager | npm | 降低初始工具数量 |
| Persistence | Markdown/JSON files | 人类可读、Git-friendly、Agent 可操作 |
| Tests | Node test runner + tsx | 无额外测试框架，覆盖代表性 happy path |
| Web | 未选择 | 到 Workbench 阶段再根据实际需求决定 |

## 模块边界

```text
interfaces (CLI/Web)
        ↓
application use cases
        ↓
domain modules
        ↓ ports
filesystem/runtime adapters
```

- Domain 不读取 Catalog、环境变量、HTTP request 或 CLI arguments。
- Catalog 只拥有 workspace/project topology，不解析领域 artifact 内容。
- Application 层编排跨领域 use case，不复制领域状态机。
- Read Model 是可重建 projection，不是业务 authority。
- 新抽象必须至少解决当前存在的两个调用方或重复问题。

当前代码结构：

```text
src/
  cli.ts                  interfaces：进程入口，注入 stdout/stderr/stdin
  app.ts                  application：命令路由与退出码
  io.ts                   CliIO 契约
  catalog/
    workspace.ts          Catalog domain：Manifest@1 schema 与纯路径逻辑
    workspaceStore.ts     filesystem adapter：发现、读写 workspace manifest
  backlog/
    store.ts              Backlog domain：store manifest schema
    add.ts                Backlog application helper：CLI 与 Plan materialization 共享 item 创建规则
    item.ts               Backlog domain：item schema、frontmatter 序列化、revision
    storeFs.ts            filesystem adapter：store 创建与读取
    itemFs.ts             filesystem adapter：item 文件读写
  plan/
    plan.ts               Plan domain：Plan@1 schema、校验与生命周期
    planFs.ts             filesystem adapter：Plan artifact 的列出、读写与解析
  report/
    report.ts             Report domain：Report@1 schema 与稳定 Markdown 序列化
    reportFs.ts           filesystem adapter：Report 的 containment、列出、读取与 no-clobber 创建
  docs/
    projectDocs.ts        Project Docs domain：固定角色和内置 Markdown 模板
    projectDocsFs.ts      filesystem adapter：预检、canonical containment、no-clobber scaffold
  useCases/
    docsScaffold.ts       application：创建固定 Project Docs 文件
    docsCheck.ts          application：只读检查固定 Project Docs 文件
    reportContext.ts      application：解析已登记 project 的 typed reports root
    reportGenerate.ts     application：从持久化 materialized Plan 与同项目 Backlog 生成 Report
    reportCreate.ts       application：`pops report create` 参数解析与 Report 生成入口
    reportList.ts         application：`pops report list` 摘要查询
    reportShow.ts         application：`pops report show` 完整查询
    ...                    每个 CLI 子命令一个 use case，编排 domain 与 adapters
```

## 数据文件格式

- workspace manifest：`.pops/workspace.json`，schema `workspace/Manifest@1`；不含绝对路径，project 以
  相对路径登记。
- backlog store：`ops/<project-id>/backlog/`，含 `backlog.json`（`backlog/Store@1`，声明
  project_id 与 id_prefix）、`items/` 与 `INDEX.md`。
- backlog item：`items/<ID>.md`，YAML 风格 frontmatter + Markdown body；`revision` 是其余内容的
  sha256 前 8 位，用于 `update --expected-revision` 的冲突保护。
- `INDEX.md` 是从 item 文件重建的可读 projection；add 和真实状态变更后同步刷新，no-op 不改写。
- Plan：`plans/plan-<title-slug>.json`，schema 为 `plan/Plan@1`；包含标题、目标与带局部 key、parent/依赖的 item 草案，
  以及 `status: draft|approved`；批准 Plan 以单个 `approval` 对象记录 `approved_at` 和 `review_note`，materialize 后以
  `materialization.mapping` 记录局部 key 到 Backlog ID 的映射以及 `materialized_at`。
  无 ASCII slug 的标题使用 Unicode code point 的 `u<hex>` token。create 验证 plans descriptor 为精确 schema type，
  并在写入前验证 plans root 的 canonical 路径仍在 workspace 内；随后使用 `wx` no-clobber 写入。list/show 读取同一
  artifact；`plan materialize` 直接调用 Backlog application helper，按拓扑顺序创建同一 project 的条目，并在完整成功后更新 Plan。
- Project Docs：`pops docs scaffold <project>` 为已登记 project 的四个固定路径生成内置 Git-friendly Markdown 模板：`README.md`、`AGENTS.md`、
  `docs/PRODUCT_SPEC.md` 和 `docs/ARCHITECTURE.md`。模板内容由 Docs domain 持有；application use case 预检 project、docs parent 和全部目标，
  通过 `wx` 创建缺失文件，已有普通文件跳过并在 JSON receipt 的 `created`/`skipped` 中返回。canonical 路径必须仍位于 project 和 workspace 内，
  非普通目标或越界 parent 会在写入前失败。
- `pops docs check <project>` 复用同一固定文档集合，只读使用 `lstat` 检查目标为普通文件并读取内容确认存在 Markdown 一级标题；符号链接按非普通文件诊断，
  缺失、非普通或缺少标题时按固定路径顺序收集全部 `problems`，不写入 project。
- Report：`reports/report-<slug>.md` 使用独立的 `report/Report@1` frontmatter，保存标题、project、`created_at`、outcome、Plan logical reference、
  Backlog 结果、验证证据、偏离、workaround 与 `repo_docs`（Repo 文档 logical references），正文为 Markdown body。Report adapter 只接受 workspace 内的 reports root，拒绝缺失或非目录 root、
  非普通 target、schema 无效文件和已存在 target；写入使用 `wx` no-clobber，序列化不会注入机器绝对路径。
- Report generation 先从 `plansRoot` 读取并校验指定的已批准、已 materialize Plan，再按 mapping 读取同一 project 的 Backlog 条目；Report 记录所有映射结果，`completed|partial` 只由 task 的实际状态和显式 partial 说明决定，生成失败不写入 Report。

## 当前 CLI 流程

1. `src/cli.ts` 把参数、I/O adapter 和 cwd 交给 `runCli`。
2. `src/app.ts` 路由到命令：`init`、`project add|list|doctor`、`docs scaffold|check`、`backlog init|add|list|show|update`、`plan create|list|show|validate|approve|materialize`、`report create|list|show`。
3. 每个子命令对应 `src/useCases/` 下的一个 use case，编排 domain 逻辑与 filesystem adapter；Docs scaffold 由 `docsScaffold.ts` 调用共享的 Docs domain 和 adapter，Docs check 由 `docsCheck.ts` 调用同一 Docs adapter；Plan 的 create/list/show/validate/approve/materialize 共享同一 `plan/` domain 和 filesystem adapter，Report 的 create/list/show 共享同一 Report domain 和 filesystem adapter；Plan materialize 通过 `backlog/add.ts` 复用 Backlog item 创建规则，不启动内部 CLI subprocess。
4. use case 以退出码表达成功、明确错误或 unknown 命令；非 JSON 错误信息写 stderr，机器可读结果经 `--json` 写 stdout（Report 命令的 JSON 失败结果也使用稳定 error envelope）。
5. 后续 command 按纵向用例加入对应 domain module，不在入口文件堆叠存储逻辑。

`project doctor` 校验 Manifest@1 的 typed artifact 声明以及 project/artifact root 的目录类型。结构损坏的
manifest 在进入 use case 前作为明确错误拒绝；doctor 只报告问题，不自动修复。

## 数据与运行时边界

- 业务数据使用 versioned Markdown/JSON schema。
- 初期不引入数据库、缓存、后台 daemon 或插件系统。
- locks、cache、logs 和临时数据不得进入版本化 artifact。
- 当前威胁模型是受信任本地用户与 workspace。
- Alpha 不承诺恶意 symlink、ancestor-swap、复杂并发、crash consistency 或跨平台原子性。
- 写入仍必须限制在命令明确选择的 workspace 内，且默认不覆盖已有用户文件。
- backlog item 文件名只接受当前 store prefix 加数字序号，CLI 参数不能通过路径片段访问 store 外文件。

## 关键架构约束

- 产品名为 ProjectOps，CLI 名为 `pops`。
- 最终发行边界是一个产品包和一个生产运行时。
- 各领域拥有独立 schema 与 lifecycle。
- Workbench 是 application API 的交互入口，不拥有第二套业务实现。
- 现有 Workspace Control 不属于运行时依赖，也不在核心实现中加入兼容或迁移代码。
