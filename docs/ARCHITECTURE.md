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
`pops report create/list/show`；独立临时 workspace 的 built CLI smoke 已覆盖 Plan → Backlog → Report 的
completed 路径、logical references、验证证据和 no-clobber 行为。Retrospective 的 Retrospective@1/Store@1 schema、workspace manifest 路由、Markdown store bootstrap、可重建索引、capture/query 与 revision-protected triage/archive lifecycle 已落地；独立临时 workspace 的 built CLI E2E 还验证了 metadata 保留、唯一 authority 移动、索引计数和 stale revision 不变式。Workbench 的 UI-neutral typed Application API、按请求重建的 workspace/project Read Model、loopback-only Local HTTP server 以及基于纯 TypeScript/原生 ESM 的可导航 Workbench 前端壳已落地，生产 build 由本地 server 直接托管；Backlog 可写切片、Plan/Report/Retrospective 阅读视图和 Docs 文档阅读已交付。上图是新增纵向能力时必须保持的目标依赖方向。

## 核心技术栈

| 层 | 技术 | 当前选择理由 |
|---|---|---|
| Runtime | Node.js 22+ | CLI、server 和构建使用单运行时 |
| Language | TypeScript | 共享 domain、application、CLI 和 Web contract |
| Package manager | npm | 降低初始工具数量 |
| Persistence | Markdown/JSON files | 人类可读、Git-friendly、Agent 可操作 |
| Tests | Node test runner + tsx；Playwright Test + Chromium | Node 测试覆盖领域与 HTTP，浏览器 E2E 验证生产 UI 闭环 |
| HTTP | Node.js `node:http` | 直接复用单运行时，不增加 server framework |
| Web UI | 纯 TypeScript + 原生 ESM + 现代 CSS | 保持单运行时与零重型外部依赖，兼顾可访问性与直接静态托管 |

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
  workbench.ts            interfaces：Local HTTP server 进程入口与 signal shutdown
  app.ts                  application：命令路由与退出码
  io.ts                   CliIO 契约
  application/
    result.ts             UI-neutral typed success/error contract
    workspaceApi.ts       workspace identity 与 project summaries 查询
    backlogApi.ts         Backlog list/show/revision-protected update API
    backlogInit.ts        Backlog 初始化：manifest 内前缀查重、分配和创建编排
    workspaceInspection.ts workspace doctor 的 typed inspection API
    workbenchReadModel.ts workspace/project 跨领域只读 projection
    docsApi.ts            文档列表与单篇正文的共享 application API
    planDependencies.ts   Plan 混合引用转换、manifest 读取与待写任务覆盖图校验
    planExecution.ts      Plan mapping 与同项目 Backlog 的实时执行进度 projection
    planComplete.ts       显式完成 Plan，共享 revision、任务及执行完成校验
    planNext.ts           Plan 查询与共享就绪任务分类、排序、依赖诊断
  server/
    workbenchServer.ts    HTTP routes、request boundary、static assets 与 server lifecycle
  web/
    index.html            Workbench HTML 骨架与挂载点
    theme.css             深色主题变量、基础元素、全局内容链接及焦点样式
    style.css             导入 theme.css，承载组件样式、页面布局与响应式规则
    planLayout.css        Plan 阅读区块、执行工作区与局部滚动布局
    types.ts              前端 AppState、ViewType 与只读模型契约
    router.ts             URL Hash 路由解析、格式化与状态恢复
    apiClient.ts          HTTP API 客户端与网络/格式错误收敛
    backlogController.ts Backlog 列表、详情、revision mutation 与异步响应隔离
    backlogView.ts        Backlog 分组列表、详情和状态更新控件
    dependencyUi.ts       Backlog 依赖编辑与共享正反向关系展示
    planDependenciesUi.ts Plan local key / 既有引用选择及草案变更
    markdown.ts           各领域共用阅读子集与源码切换，HTML 转义、受限链接和标题回调
    docsView.ts           文档导航、正文、章节目录及相对链接解析
    state.ts              前端状态机核心与不可变状态转移
    readPagesView.ts       Plan/Report/Docs/Retrospective 只读详情与回顾过滤
    render.ts             语义化 HTML 纯函数渲染与可访问性属性
    app.ts                生命周期编排、事件委托与 DOM 挂载
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
  retrospective/
    retrospective.ts      Retrospective@1 与 Store@1 schema、Markdown 序列化
    retrospectiveFs.ts    workspace-level store bootstrap、containment、capture、读写、revision-protected transition 和索引重建
  docs/
    projectDocs.ts        Project Docs domain：固定角色和内置 Markdown 模板
    projectDocsFs.ts      filesystem adapter：预检、canonical containment、no-clobber scaffold
    documentReader.ts     有界 Markdown 枚举与只读文件读取，静态 ancestor/target 校验
  useCases/
    docsScaffold.ts       application：创建固定 Project Docs 文件
    docsCheck.ts          application：只读检查固定 Project Docs 文件
    reportContext.ts      application：解析已登记 project 的 typed reports root
    reportGenerate.ts     application：从持久化 materialized Plan 与同项目 Backlog 生成 Report
    reportCreate.ts       application：`pops report create` 参数解析与 Report 生成入口
    reportList.ts         application：`pops report list` 摘要查询
    reportShow.ts         application：`pops report show` 完整查询
    retrospectiveContext.ts application：解析 Manifest@1 的 workspace retrospectives descriptor
    retrospectiveCapture.ts application：`pops retrospective capture` 参数校验和 inbox 写入
    retrospectiveList.ts application：`pops retrospective list` 过滤和 malformed diagnostics
    retrospectiveShow.ts application：`pops retrospective show` 完整记录查询
    retrospectiveTriage.ts application：`pops retrospective triage` 分类并将 inbox 记录移入 active/archive
    retrospectiveArchive.ts application：`pops retrospective archive` 将 active 记录结案到 archive
    ...                    每个 CLI 子命令一个 use case，编排 domain 与 adapters
```

`src/application/` 是 CLI、Local Web Workbench 与未来 Agent interface 的共享调用面。它接收 typed request，
返回 `ApplicationResult<T>`，不解析 CLI arguments、不格式化 JSON、不依赖 `CliIO`、HTTP 或 UI 类型，也不在
错误结果中暴露机器绝对路径。当前覆盖 workspace/project 查询、Backlog
list/show/update 以及四个领域的完整只读 projection；现有 CLI 对应命令负责参数、文本/JSON 输出和退出码，并把业务处理委托给这些 API。其他
领域仍按需求逐步迁移，不建立通用 command bus 或 Artifact service。

`workbenchReadModel.ts` 直接组合各领域公开读取能力。workspace overview 包含 workspace identity、稳定排序的
project summaries 与 doctor diagnostics；project overview 包含 Backlog 状态计数/最近条目、Plan/Report 摘要、
Docs check、project-scoped Retrospective 计数和最近记录。projection 不保存状态；malformed artifact 或单领域
不可用时返回按 source/reference 稳定排序的 diagnostics，并继续返回其他可用领域，不复制 schema parser。

`workbenchServer.ts` 是 application API 外的薄 HTTP adapter。启动参数固定唯一 workspace，并默认绑定
`127.0.0.1:7331`；host 只接受 loopback，测试可使用 port `0` 获取隔离端口。路由提供 workspace/project
overview、Backlog list/show/update、Docs list/show 和 `GET /api/projects/<id>/read-pages`，统一返回 `{ ok, data }` 或 `{ ok, error }` JSON envelope，并把 stale
revision 映射为 HTTP 409。请求不能提供 workspace path；除 Backlog list 的 `status` 和 Docs/Research show 的 `path` 外拒绝 query 参数。
PATCH 接受 `application/json`、无 Origin 或与 server origin 完全相同的 Origin，以及有界 body；状态更新与内容编辑分开校验，内容编辑要求 revision。server 可从显式 static root 提供前端资源，realpath containment 防止 URL
访问 root 外文件；未提供 static root 时自动查找内置 `dist/web` 生产资源，只有资源尚未构建时才返回占位页。
关闭先停止接收连接，随后有界清理残留连接。

`getWorkbenchReadPages` 与 overview 共享 Plan/Report/Retrospective 领域读取器和 Docs check，返回 `WorkbenchReadPages`：
Plan、Report 保留各自 domain 类型，Docs 从 `PROJECT_DOC_TEMPLATES` 派生固定路径及检查结果，Retrospective
返回完整 workspace 记录。单个 malformed 文件被转换为诊断，不中断其他有效文件；不通过 CLI subprocess、
CLI JSON 或前端 schema parser 读取数据。此 projection 按需从 read-pages endpoint 加载，Alpha 阶段一次返回
四个领域的完整内容，无分页或持久化缓存；overview 继续保留轻量摘要契约。

`readPagesView.ts` 以原生 `<details>` 提供可键盘展开的 Plan、Report 和 Retrospective 详情，Report/Retrospective 正文默认通过共享阅读组件渲染，源码可切换；正文和关键行动优先，metadata 折叠。Plan 采用任务目录与独立折叠正文，技术记录单独折叠。
Retrospective 在完整 typed 列表上按 status/project/task 精确过滤，默认 project 为当前项目，留空表示全部，
`null` 表示 provenance 未记录；按 inbox/active/archive 分组并保留不受过滤影响的 malformed diagnostics。
Docs 页面独立调用 docs endpoint 获取列表和单篇正文，`read-pages.documents` 仍仅保留固定路径检查摘要。`app.ts` 管理按需加载、重试、刷新和过滤状态，使用请求序号隔离过期响应；
项目切换清除旧 projection 并重置过滤。Report、Retrospective、Docs 保持只读；Plan 修订由独立 application API 提供，Docs 仅提供限定文档范围的读取接口。

Workbench Backlog 页面通过 HTTP list/show/update 获取完整数据，独立于 overview 的最近五条摘要。
`backlogController.ts` 管理列表、当前详情和提交状态：提交携带已加载 revision，成功后重读列表和详情并刷新
project overview；409 保留旧详情和当前选择，用户显式刷新后才能再次提交。项目切换会废弃旧请求的 UI
结果，进行中的提交不允许重复触发。页面依据 `depends_on` 与已读取 item 状态显示未完成/缺失依赖提示，
不引入额外的 mutation 规则。各内容页面经 `markdown.ts` 渲染受限阅读子集，所有输入文本转义；HTTP(S) 外链可点击，Docs/Report 通过各自链接解析器生成受限内部路由；
原始 HTML、图片及未支持语法不执行，可展开源码切回原文。源码模式与 details 展开状态仅保存在会话内存，
`app.ts` 按项目和条目 key 在重新渲染时恢复，不增加持久化状态；Plan 目录通过 DOM 定位，不改写 router hash。
workspace 连接重试期间的路由变化只更新目标路由，待 workspace 响应到达后再加载项目。

测试以隔离临时 workspace、port `0` 和真实 HTTP API 覆盖列表、DOM 事件分发、更新后的 authority 文件、
project summary、revision conflict 与刷新重试；只读视图测试覆盖四领域正常、空状态与诊断、完整详情、回顾过滤、刷新和读取前后文件不变；
异步单元测试覆盖项目切换和重复提交。

`tests/browser/` 与 `playwright.config.ts` 提供独立 `npm run test:e2e` 门禁。它先构建，使用 built CLI
在每项测试的 `mkdtemp` workspace 中准备数据，再启动 `dist/workbench.js --port 0` 子进程，读取实际绑定地址。
真实 Chromium 从 server 托管的 `dist/web` 加载前端，使用可访问性 locator 操作项目选择、导航、详情、
Backlog 状态更新与冲突重试、Retrospective 过滤；文件快照核对只读浏览、stale revision、未知项目及
server 断连均不产生错误写入。测试不用真实用户 workspace，不依赖预先启动的固定端口服务。

fixture 的 CLI 调用与 server 启动各限时 10 秒；Playwright browser launch/navigation 限时 10 秒，
action/assertion 限时 5 秒，单测试 30 秒、整套 120 秒，不自动重试。server 在 fixture `finally` 中发送
SIGTERM，2 秒未退出则 SIGKILL，4 秒仍未退出则报错；随后清理本次临时目录。浏览器和隔离 context
由 Playwright fixture teardown 关闭，失败 trace 留在 Git 忽略的 `test-results/`。测试采用受信任本地
临时目录边界，不增加 native helper 或恶意 ancestor-swap 承诺。Playwright 仅是 devDependency，生产运行时仍为 Node.js。

## 数据文件格式

- workspace manifest：`.pops/workspace.json`，schema `workspace/Manifest@1`；不含绝对路径，project 以
  相对路径登记；顶层 `retrospectives` descriptor 使用 `type: workflow/retrospectives@1` 与相对 `root` 指向
  唯一 workspace-level Retrospective store，默认由 `pops init` 写入 `retrospectives/`。
- backlog store：`ops/<project-id>/backlog/`，含 `backlog.json`（`backlog/Store@1`，声明
  project_id 与 id_prefix）、`items/` 与 `INDEX.md`。
- Backlog 初始化由 `application/backlogInit.ts` 编排，CLI 只解析 `--id-prefix`、输出收据与退出码。
  application 在 workspace 初始化锁内重读 manifest，校验 Backlog descriptor 并只枚举登记项目；filesystem adapter 检查静态目录边界、初始化文件类型和 Store@1，application 核对 project_id 归属。
  未初始化必须是可读取 root 且三个初始化目标均不存在；缺失/不可读 root、部分初始化或无效 store 返回带项目和相对位置的恢复诊断，不能视为未占用。不扫描条目正文或其他系统。
  domain 沿用非空 ASCII `A-Z`/`0-9` 代号规则；自定义值原样验证，自动 base 为 project ID 去连字符、取前三位并转大写，依次选择 `base`、`base2`、`base3`……中的首个空闲候选。
  例如 mochi 占用 `MOC` 后，mochi-write 得到 `MOC2`；自定义冲突返回占用项目，不改用自动值。收据中的 id_prefix 来自实际写入的 manifest，不重新推导。
  `.pops/runtime/backlog-init.lock` 排他空目录覆盖读取占用集合、分配与 `createStore` 的 `wx` no-clobber 写入；锁忙时立即拒绝，正常成功/失败通过 finally 释放自身锁，不删除其他进程的锁。
  沿用有限 I/O 失败清理，不建立前缀 registry、通用事务或 migration。旧 store/ID 与重复 init 的保护不变。
  该协调只覆盖正常并发 backlog init；manifest 注册和手工编辑不参与锁，初始化期间不得并发改写。中断残留空锁须确认无初始化进程后人工移除，不自动恢复崩溃或清理业务数据。
  支持受信任本地 Linux workspace、Node.js、静态路径检查，无 native helper；不承诺同用户恶意 ancestor swap 或其他平台等价原子性。
- backlog item：`items/<ID>.md`，YAML 风格 frontmatter + Markdown body；`revision` 是其余内容的
  sha256 前 8 位，用于 `update --expected-revision` 的冲突保护。
- `INDEX.md` 是从 item 文件重建的可读 projection；add 和真实状态变更后同步刷新，no-op 不改写。
- Plan：`plans/plan-<title-slug>.json`，schema 为 `plan/Plan@1`；包含标题、目标与带局部 key、parent/依赖的 item 草案，
  以及 `status: draft|approved|done`；批准 Plan 以单个 `approval` 对象记录 `approved_at` 和 `review_note`，materialize 后以
  `materialization.mapping` 记录局部 key 到 Backlog ID 的映射以及 `materialized_at`。
  无 ASCII slug 的标题使用 Unicode code point 的 `u<hex>` token。create 验证 plans descriptor 为精确 schema type，
  并在写入前验证 plans root 的 canonical 路径仍在 workspace 内；随后使用 `wx` no-clobber 写入。list/show 读取同一
  artifact；`plan materialize` 直接调用 Backlog application helper，按拓扑顺序创建各目标 project 的条目，每项写入后保存 partial mapping，全部完成后移除 partial 标记。
  `planDependencies.ts` 将局部 key 转换为本项目 ID，限定引用原样保留；通过 `readTaskReference` 按 manifest 读取可达既有任务，检查重复与循环，不要求外部 done。修订采用 pending tasks 覆盖图检查，避免按磁盘旧图误判批量改动；不写入外部 store。
  已物化重复调用保留 no-op，未变化的修订不因外部变动重写 Plan 或执行历史；mapping 与完成范围始终只有本 Plan 自有条目。
- Project Docs：`pops docs scaffold <project>` 为已登记 project 的四个固定路径生成内置 Git-friendly Markdown 模板：`README.md`、`AGENTS.md`、
  `docs/PRODUCT_SPEC.md` 和 `docs/ARCHITECTURE.md`。模板内容由 Docs domain 持有；application use case 预检 project、docs parent 和全部目标，
  通过 `wx` 创建缺失文件，已有普通文件跳过并在 JSON receipt 的 `created`/`skipped` 中返回。canonical 路径必须仍位于 project 和 workspace 内，
  非普通目标或越界 parent 会在写入前失败。
- `pops docs check <project>` 复用同一固定文档集合，只读使用 `lstat` 检查目标为普通文件并读取内容确认存在 Markdown 一级标题；符号链接按非普通文件诊断，
  缺失、非普通或缺少标题时按固定路径顺序收集全部 `problems`，不写入 project。
- Report：`reports/report-<slug>.md` 使用独立的 `report/Report@1` frontmatter，保存标题、project、`created_at`、outcome、Plan logical reference、
  Backlog 结果、验证证据、偏离、workaround 与 `repo_docs`（Repo-relative 文档路径，如 `README.md`），正文为 Markdown body。Report adapter 只接受 workspace 内的 reports root，拒绝缺失或非目录 root、
  非普通 target、schema 无效文件和已存在 target；写入使用 `wx` no-clobber，序列化不会注入机器绝对路径。
- Report generation 先从 `plansRoot` 读取并校验指定的已批准、已 materialize Plan，再按 mapping 读取同一 project 的 Backlog 条目；Report 记录所有映射结果，`completed|partial` 只由 task 的实际状态和显式 partial 说明决定，生成失败不写入 Report。CLI 通过 `--verification` 记录验证证据，未完成 task 必须以非空 `--partial-acceptance` 显式接受 partial。
- Retrospective store：`retrospectives/retrospective.json` 声明 `retrospective/Store@1`、记录 schema 与索引 schema；`inbox/`、`active/`、`archive/` 保存 `*.md` 权威记录，`index.json` 和 `INDEX.md` 是可重建派生索引。Retrospective@1 的 `project`、`task` provenance 可为显式 `null`，但不能缺失；triage metadata 使用 `disposition`、`owner_scope`、`categories`、`next_action`、`related_info`，archive metadata 使用 `action_disposition`、`actioned_at`、`backlog`、`resolution_note`，并保留已有的 `next_action`。Store adapter 只接受 manifest descriptor 指定且位于 workspace 内的静态目录，bootstrap 和记录创建均使用 no-clobber；不把 Retrospective 纳入 per-project artifact 状态机。capture/transition 的共享锁按 store 相对路径生成稳定 identity，存放在 workspace `.pops/runtime/retrospectives/`，不写入版本化 Retrospective root。
- Retrospective capture 只保存调用方提供的证据并强制写入 `inbox/`；Markdown body 必须包含三个非空 section：`Hidden friction encountered`、`Workarounds used` 和 `Improvement candidates`。记录输出的 revision 是 Markdown 文件内容 sha256，列表按相对 path 稳定排序并支持 status/project/task 过滤。显式 ID 与自动 ID 都在共享锁内跨 `inbox/`、`active/`、`archive/` 检查唯一性，自动 suffix 从所有状态和已有重试记录中分配。读取列表将 malformed 记录转换为 diagnostics，避免单个文件破坏 read model；capture 在索引刷新失败时回滚本次文件和完整索引快照，并清理已创建后发生写入错误的部分文件。`triage` 只允许 `inbox → active|archive`，显式要求 `--to` 和非空 `--next-action`；`archive` 只允许 `active → archive`，保留记录已有的 `next_action`，其 `--backlog` 只接受 `project-ops:backlog/items/<PREFIX>-NNN.md`。两者在共享锁内校验 expected revision、静态 regular target 与 no-clobber 目标，失败回滚 source/target/index 快照，成功后重建派生索引。不把 Retrospective 纳入 per-project artifact 状态机。

## 当前 CLI 流程

1. `src/cli.ts` 把参数、I/O adapter 和 cwd 交给 `runCli`。
2. `src/app.ts` 路由到命令：`init`、`project add|list|doctor`、`docs scaffold|check`、`backlog init|add|list|show|update`、`plan create|list|show|validate|approve|materialize`、`report create|list|show`、`retrospective capture|list|show|triage|archive`；Retrospective capture/query/transition 共享同一 domain/adapter。
3. 每个子命令对应 `src/useCases/` 下的一个 use case，编排 domain 逻辑与 filesystem adapter；Docs scaffold 由 `docsScaffold.ts` 调用共享的 Docs domain 和 adapter，Docs check 由 `docsCheck.ts` 调用同一 Docs adapter；Plan 的 create/list/show/validate/approve/materialize 共享同一 `plan/` domain 和 filesystem adapter，Report 的 create/list/show 共享同一 Report domain 和 filesystem adapter；Plan materialize 通过 `backlog/add.ts` 复用 Backlog item 创建规则，不启动内部 CLI subprocess。
   `project list` 与 Backlog list/show/update 已成为薄 CLI adapter，调用 `src/application/` 的 typed API；Web
   后续直接调用同一 API，不复用 CLI 参数或输出格式。
4. use case 以退出码表达成功、明确错误或 unknown 命令；非 JSON 错误信息写 stderr，机器可读结果经 `--json` 写 stdout（Report 命令的 JSON 失败结果也使用稳定 error envelope）。
5. Report CLI 的 create/list/show 共享同一 Report application/domain 与 filesystem adapter；create 先完成 Plan/Backlog 资格校验，再以 no-clobber 写入 `reports/report-<slug>.md`。
6. 后续 command 按纵向用例加入对应 domain module，不在入口文件堆叠存储逻辑。

`project doctor` 校验 Manifest@1 的 typed artifact 声明以及 project/artifact root 的目录类型。结构损坏的
manifest 在进入 use case 前作为明确错误拒绝；doctor 只报告问题，不自动修复。

`init` 路由校验 `--json`、`--skip-skill` 和至多一个目录参数。数据初始化保留既有回滚边界；数据完成后调用 skill adapter，
后者失败不回滚已可用的 manifest/Retrospective store，以 `ok:false,workspace.initialized:true,skill` 分阶段报告。

## 数据与运行时边界

- 业务数据使用 versioned Markdown/JSON schema。
- Alpha 运行时只支持当前 schema；自身 dogfooding 的活动数据通过一次性脚本迁移，不增加旧版 parser、
  双写或自动升级路径。脚本在恢复副本保留、迁移完成及内容/状态/引用验证通过后删除，不作为产品模块维护。
- 迁移对象只包含 dogfooding 产生且仍在使用的数据及明确需要处理的引用，不包含 Workspace Control 既有数据。
  完成或归档数据无需持续升级；演进时对不可读旧版本提供明确诊断，并隔离其对有效活动数据的影响。
- 初期不引入数据库、缓存、后台 daemon 或插件系统。
- locks、cache、logs 和临时数据不得进入版本化 artifact。
- Workbench Read Model 按请求从 authority 重建，不引入数据库、缓存或后台 daemon；其 relative/logical references
  与 diagnostics 可传给 interface，filesystem 绝对 root 只保留在 application 内部。
- Local HTTP server 的 workspace 和可选 static root 只在启动时选择，HTTP 请求不能更换它们；错误响应不返回
  stack trace 或机器绝对路径。server 不持久化业务数据之外的第二份状态。
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

## Plan 执行进度 projection

Overview 的 `plans[].execution` 复用 `readPlanExecution`，仅保留 materialized、counts、completion_percent 与
逐项读取 diagnostics；不携带任务正文或另存执行状态。未完成计划优先、同组 ID 排序在 application 层完成。
Overview 的 `backlog.mode` 为 active/recent，`recent` 为对应范围的最多五条预览：活动条目按进行中、待办、
优先级、ID 排序，无活动条目时按更新时间倒序、ID 升序。计数保留全量已读取状态，Web 据 mode 显示预览范围。
报告摘要限当前项目，按解析后的生成时间倒序、ID 升序；读取失败保留领域 diagnostics。
Overview 回顾 projection 从现有正文派生纯文本 summary，不增加持久化标题字段；按创建时间/ID 排序，
只输出当前项目的五条预览和状态计数。文档 projection 枚举 PROJECT_DOC_TEMPLATES 的四个固定路径，
复用 readProjectDocument 判定 readable，正文不进入聚合响应；issue 保留不可读原因或既有标准检查问题。
现有文档路径约束保持不变，不为 Overview 枚举扩展文档或另建文件读取实现。

`getWorkbenchReadPages` 返回的 `plans[]` 在 Plan 数据上附加 `execution`，持久化 Plan schema 不变。
`readPlanExecution` 通过共享 `showBacklogItem` 逐项读取同项目 mapping；局部读取失败只影响该条目，
不使用全量 Backlog 列表失败结果覆盖其他有效任务。`execution` 包含 `materialized`、`counts`、
`completion_percent` 和按 Plan 顺序的 `items`（key、id、title、item_type、status、可选 diagnostic）。
counts 按 Plan task 统计 total、todo、in_progress、done、blocked、cancelled、unreadable；epic 仅展示。
缺失、损坏、项目/类型不匹配和不可读取的目标使用计划标题回退及逐项诊断，不泄露本机路径。
未物化或零 task 的完成百分比为 null；其余为 done/total 百分比向下取整。Web 只渲染该 projection，
Refresh 重建数据，不写 Plan/Backlog 或缓存进度。HTTP 测试验证只读、失败隔离及计数；浏览器测试验证 CLI 更新后的刷新与窄屏显示。

## Plan 就绪任务查询

`application/planNext.ts` 的 `getPlanNext` 解析 workspace/project 与 Plan，返回 `ApplicationResult<PlanNextSummary>`；
`readPlanNext` 对已读取 Plan 生成同一份就绪 projection，供后续 Web 调用。它通过共享 `showBacklogItem`
读取映射 task 和其直接依赖，逐项收敛不可读数据；不依赖全量 Backlog list 的整体成功，也不递归遍历依赖。
分类与排序均在 application 层完成，`useCases/planNext.ts` 只处理 CLI 参数、文本/JSON 格式与退出码。
CLI 将成功 data 展开到顶层，将失败转换为 `{ok:false,error}`，JSON 模式只写 stdout。
Workbench read-pages 在 `plans[].next_tasks` 中复用 `readPlanNext`，不新增独立推荐 endpoint；持久化 Plan、Backlog 契约不变。
隔离测试覆盖多优先级排序、同项目 Plan 外依赖、失败隔离、空推荐、共享 API/CLI 等价以及 built CLI 的只读和错误行为。

## Plan 详情导航

前端 `RouteState` 使用可选 itemId/planId 描述 Backlog 详情和来源 Plan，`router.ts` 解析/生成项目限定 hash 地址；跨项目任务链接以 `returnTo` 保存来源 Plan 或任务。
`AppState.selectedPlanId` 保留当前导航上下文；read-pages 用 `plans[].next_tasks` 渲染共享查询结果，
通过真实链接进入所属项目的 Backlog controller，返回链接恢复来源项目及 Plan。
`dependencyUi.ts` 读取 application 的实时正反向关系，保留读取不完整诊断；依赖草稿单独保存 revision，错误不清空草稿。
`foundationUi.ts` 将 Plan 依赖选择写入现有 JSON 草案并沿用 revision preview/confirm；物化任务通过同一依赖 API 展示实际关系，成功修订后重新读取。
`loadBacklogRoute` 在列表加载后按当前地址选择详情，导航计数及 controller generation 丢弃过期响应；
项目/页面切换清理旧详情。返回 Plan 的 `loadReadPages` 先清除旧 projection，成功后展开、滚动定位并聚焦原 Plan。
状态更新仍调用现有 Backlog API，不在 Plan 新建状态修改路径。隔离浏览器测试覆盖完整返回流程、
revision 请求、失效任务链接、跨项目切换和读取期间 authority 不变；共享查询测试核对 Web/CLI 数据等价。

## Plan 交付报告 projection

`getWorkbenchReadPages` 先读取有效 Report 与 diagnostics，再为每份 Plan 添加 `delivery_reports` 摘要数组。
匹配条件是 Report.project 等于当前项目，且 Report.plan 等于该 Plan 的 logical reference；
按解析后的 created_at 时间降序、ID 升序返回全部匹配项，不新增持久化字段或跨 artifact 索引。
`WorkbenchPlan` 的 execution、next_tasks、delivery_reports 都是每次请求重建的 projection。
Plan 页同时展示 Report 读取诊断；无法归属到某份 Plan 的损坏报告使用页面级诊断，不猜测关联。
`RouteState.reportId` 与 `AppState.selectedReportId` 支持 Report 详情定位，复用来源 planId 和读取页的
焦点/滚动恢复。返回原 Plan 时重读 projection；报告 outcome 和正文始终来自其持久化快照。
领域读取测试覆盖跨项目过滤、多个报告的时间/ID 排序、损坏隔离与快照不变；浏览器测试覆盖
Plan 创建、批准、物化、任务变化、下一步查询、partial/completed 报告展示及往返导航的闭环。

## 文档读取与阅读导航

`application/docsApi.ts` 通过 Catalog 解析登记项目，调用 `docs/documentReader.ts` 返回 typed list/show，HTTP 仅处理方法和 query。
`listProjectDocuments` 保留四个标准入口、复用一级标题检查，并在 `docs/` 内枚举 Markdown；扩展文档不参与标准健康检查。
`readProjectDocument` 校验相对路径和范围，再逐级检查目录/文件为普通目标且 realpath 仍在 Repo 内；不跟随 symlink。
此读取是受信任本地 workspace 下的静态边界，不抵抗恶意并发替换祖先；使用现有 Node.js 能力，无 native helper。
文档正文不加入 read-pages 聚合 payload，`GET /api/projects/<id>/docs?path=...` 仅返回选中文档的 path/body。

`docsView.ts` 复用 `renderReadingBody`，通过 headingId 回调生成章节目录，通过 resolveLink 回调解析相对 Markdown 和章节锚点；同一阅读布局也服务 Research root 的列表与正文。
共享渲染器只接受 HTTP(S) 或解析器产生的内部 `#/projects/` 链接；原始 HTML 和未支持目标不执行。
`RouteState` 扩展 documentPath/section、retrospectiveId/retrospectiveFilters 和受限 returnTo。
回顾筛选在已有 projection 上立即执行，详情直达时可单独展示筛选外记录；跨页返回重读数据。
`app.ts` 用单独 documentRequestId 丢弃晚到的文档响应；路由记录选中目标、章节和过滤，内存 Map 保留 details 与滚动位置。
整页重载通过 URL 恢复目标/过滤/章节，内存中的源码模式和像素位置不持久化，不新增业务 schema 或派生索引。
`mermaidClient.ts` 将官方 Mermaid ESM 本地打包为独立浏览器模块，共享 Markdown 入口提供转义源码占位；DOM 更新后渲染，过期结果不挂载。
采用 strict、禁用 HTML labels 并锁定安全配置；图片节点在渲染前降级，输出拒绝活动元素，页面 CSP 禁止图片、外部样式和嵌入内容。
语法错误保留源码，其余正文继续可读。集成 API 依据 [Mermaid 官方用法](https://mermaid.js.org/config/usage) 与 [配置契约](https://mermaid.js.org/config/schema-docs/config)。
Research 通过 manifest 的 `markdown/research@1` descriptor 解析 `projectArtifactRoots(...).research`，只枚举 root 内普通 `.md` 文件；root 或 descriptor 失效作为诊断，不伪装为空目录。Research HTTP 测试覆盖正常阅读、缺失、非 Markdown 和越界目标。
Docs HTTP 测试覆盖正常阅读、缺失、非 Markdown、路径越界和 symlink 逃逸；Chromium 测试覆盖源码/目录、
关联返回、浏览器前进后退、读取失败重试、快速切换项目和窄屏，并用文件快照验证只读。

## Alpha 样式约定

`web/theme.css` 集中定义颜色、字体与阅读排版变量，以及 reset、body、普通链接和键盘焦点的基础样式；
`web/style.css` 导入主题层，保留现有组件与页面布局。原生控件声明 dark color-scheme。
普通内容链接使用统一的 link/link-hover 变量，已访问链接保持同一可读颜色；hover/focus 同时加强下划线，
不依赖浏览器默认蓝紫色。基础链接选择器保持低优先级，品牌、导航、按钮等组件保留自己的语义样式。
新页面的内容链接默认复用基础层，避免逐页补充颜色。新增主题颜色集中到 theme.css，以语义变量引用；
阅读区域复用 bg-reading、text-reading、reading-measure、reading-line-height。Overview 使用两列响应式网格与
独立内容高度，条目标题、元信息和 ID 纵向排列，相关样式限定在 overview-card 下，避免影响详情布局。
不引入 CSS framework 或完整设计系统。共用控件和页面例外见 [前端规范](FRONTEND_GUIDELINES.md)。

Plan 的 `readPagesView.ts` 输出执行工作区 host；`planRunUi.ts` 与 `parallelRunUi.ts` 将各自面板挂到该 host，保持各自领域数据和控制逻辑。当前活动记录与终态历史仅在展示层分组，不修改业务资格或状态机。运行面板轮询重绘保留输入草稿、焦点、局部 details 展开状态和页面滚动位置。`planLayout.css` 由页面显式加载，复用主题与按钮，只负责 Plan 布局。


## 修订与执行基础

`application/planRevision.ts` 组合 Plan parser、Backlog 读取和受控文件更新；preview token 锚定 Plan revision、
草案与受影响任务 revision，confirm 时重新计算。保持已物化 mapping，只更新可安全同步的 todo 内容；
历史执行、已开始/完成或独立改写的任务禁止 Plan 隐式覆盖。普通写入错误恢复本次 Plan/item/index 快照，
不引入通用事务层。`backlogApi.ts` 的内容编辑与 Plan 修订使用不同显式入口，共用 revision 和领域 parser。

`execution/attempt.ts` 定义 Attempt；`execution/store.ts` 经 manifest 定位 executions root，执行文件采用 no-clobber 创建，
后续变更检查 revision；证据文件存于该 root 的 evidence 子目录。`execution/snapshot.ts` 调用 Git 参数数组，
捕获 HEAD、diff 和工作文件摘要，不通过 shell 执行；证据和快照作为工作事实保存，不把临时日志作为唯一长期证据。
`application/executionApi.ts` 提供 create/list/show/finish/verify/decide，共用 CLI 与 HTTP，无内部 CLI subprocess。验收允许冻结任务由 todo 正常推进到 in_progress，并忽略 revision/updated 的派生差异；其余完整内容仍比较，done/cancelled 与其他状态变化拒绝。

`application/verificationChecks.ts` 供独立执行验收、串行 run 与并行 run 共用：按指定 snapshot digest 筛选验证，
每个 command 只采用最后一条记录，再核对 passed 及持久化证据的可读性和内容摘要。调用方决定目标快照、
空验证的诊断、attempt 是否最新以及状态、输入、baseline 和 checkout 条件；该模块不拥有验收或调度状态机。

`execution/runtime.ts` 持有注入 Runner 返回的 completion/stop handle，管理重复启动、停止确认和启动后核对。
RunnerContext.recordVerification 仅供当前 runtime handle 使用，在 running 状态保存命令、真实工具结果、证据摘要与即时 Git 快照；后续 finish 不重标旧验证的快照，accept 仍校验当前版本和完整证据。
后端负责生命周期，浏览器轮询只读记录；runtime/external 来源分开，重启仅核对 runtime 所属活动工作。
未知工作要求人工确认而不重新执行；默认服务没有 runner，仍可查看和验收外部记录。
单本地服务 owner 是当前运行边界，不提供分布式 lease、多服务协调或自动 crash recovery。

`server/workbenchServer.ts` 固定 workspace，新增 Plan revision 与 executions 路由，共用 JSON/Origin/body 限制和错误 envelope；
请求不能改 workspace，运行输入由项目和任务解析。`useCases/executionCommand.ts` 解析 CLI 参数，
`executionCli.ts` 调用同一 application API；finish/verify 是外部事实记录，不运行声明的验证命令。
验收检查输入版本、当前 Git 快照与有效验证，持久化决定并推进 Backlog；失败尝试恢复相关文件，诊断无法恢复的情形。
业务状态不写数据库，也不把 Plan 意图变成执行状态机。


## Pi runner

`execution/piRunner.ts` 以固定 Pi SDK 0.85.0 实现 Runner port，生产 Node 最低版本为 22.19.0。`ExecutionRuntime` 从 manifest 解析 Repo，注入 repo/workspaceDir/emit；runner 不接受浏览器路径。
`workbench.ts --pi` 是显式启用入口。SDK 默认 SettingsManager/模型运行时读取本机模型和凭据；DefaultResourceLoader 加载 AGENTS 与 skills，明确关闭 extensions/templates/themes；tools allowlist 为 read/bash/edit/write。
`execution/piModels.ts` 通过同一 `getAgentDir()` 创建 ModelRuntime，每次列表请求重读本地认证与模型配置，
仅投影 provider/id/name。Runner 的可选 listModels/resolveModel port 为 HTTP 提供列表及启动前解析；
默认选择通过禁用工具、extensions 和 skills 的内存 SDK session 解析，使用目标 Repo 设置，随即 dispose，不发送模型请求。
`web/modelSelector.ts` 管理 header 展示与浏览器选择记忆；启动请求携带 model，服务端校验可用性后写入 attempt 输入或 run 快照。
串行与并行 scheduler 从 run.model 派发，Pi runner 显式传入模型且不对失效选择回退；recordModel 回调将实际模型保存到 progress.model。

Pi runner 对首行 `# projectops-verify` 的 bash 按 toolCallId 配对开始和完成事件，把实际 result/isError 交给 runtime.recordVerification，不读取摘要声明。未标记命令不登记，写入失败或未完成事件阻止 succeeded。保留工具返回的截断提示，不沿工具提供的临时路径自动读取其他文件；操作者按证据完整性补充日志。

每次尝试建立独立 `.pops/runtime/pi/<attempt-id>/` session，逐级拒绝 symlink/非目录。执行记录只保存 session ID、模型/加载清单状态与有界进展；不把凭据或 Pi 全量 session 复制进 artifact。
开始异步返回，runtime 持久化 emit 事件；HTTP steer 使用相同 revision 与请求保护，再调用 handle.steer。停止先 clearQueue 再 abort；完成 await prompt，不使用中间 agent_end 事件。最终 stopReason 区分错误和中止，SDK session 最后 dispose。
该适配器不是 sandbox；既有 execution verification/acceptance 仍是任务完成 authority。断线与页面刷新不影响服务端工作，重启未知工作仍需人工核对。

纯进展事件写入保留当前控制 revision；停止、追加指示和生命周期变更仍更新 revision 并校验 CAS，持续输出不会使控制操作持续冲突。

Pi 0.85.0 发布包的根入口静态引用 pi-server，但未声明依赖；项目显式固定 `@earendil-works/pi-server@0.85.0` 补齐该上游依赖。升级 Pi 时重新核对并移除已不需要的补充依赖。Pi SettingsManager 读取也需要临时文件锁，读取失败明确返回配置权限诊断，不静默使用空模型。


## 串行 Plan run

`planRun/planRun.ts` 的 `execution/PlanRun@1` 独立于 Plan 意图，保存在 manifest executions root 的 `plan-runs/`。记录 Plan/任务快照、mapping、显式依赖、每节点 attempt 历史、初始与当前 Repo 基线、控制说明和诊断。
`application/planRunApi.ts` 组合既有 ExecutionRuntime 与验收证据；不从数组顺序补依赖，不创建第二套任务验收。`server/planRunRoutes.ts` 复用同一个 execution runtime，定时推进已启动的运行；`web/planRunUi.ts` 展示快照、依赖及控制。

运行状态为 ready/running/paused/completed/stopped，节点为 pending/running/awaiting_acceptance/accepted/failed/unknown。生命周期观察在输入漂移时仍更新，输入和基线验证控制是否继续派发。纯查询不派发，创建 ready 不自动启动；容量一的调度在用户显式启动后进行。
已验收节点可使用其历史快照证据，run 当前 baseline 必须等于当前 Repo；未开始节点仍核对冻结 revision。完成复用需要当前有效 accepted attempt、完整验证证据和人工 reuse note。
Report 写入先按当前 Plan/Backlog 规则派生，再核对最新 matching run 的实际输入、基线和证据；未确认的 run 即使 Backlog 手动 done 也不能生成 completed。


## 并行 runtime 与 Git 工作区

`planRun/parallelRun.ts` 定义 `execution/ParallelRun@1` 快照和容量/资源就绪选择；`application/parallelRunApi.ts` 负责输入核对、派发、验收观察、显式控制与串行落地。串行和并行 runtime 复用 `ExecutionRuntime`，managed checkout 由 ownership 解析，不接受浏览器路径。

并行记录保存于 execution root 的 `parallel-runs/`；`planRun/worktrees.ts` 在 workspace runtime 下为 run 建专用 integration、节点和候选 worktree。Git expected-ref 更新约束正常并发，metadata 和静态 containment 防止误用其他目录。受支持边界是受信任本地 Linux workspace、静态 symlink 检查和正常并发 no-clobber；不承诺同用户恶意 ancestor-swap resistance，不依赖 native helper。

每次落地先重验节点当前快照和接受证据，再从当前 integration head 创建独立候选，执行固定 argv 验证命令并保存 verification/landing JSON。只有验证成功、integration checkout 仍 clean/detached 且 ref CAS 成功时推进 head。失败候选、旧接受记录与新返工尝试分别保留。Report 发布再次校验实际 run/evidence/ref，不依赖 UI 状态推断完成。

## Plan 显式完成

`pops plan complete` 和 `POST /api/projects/<project>/plans/<plan>/complete` 复用 `completePlan`，输入为当前
`expected_revision`。application 从 manifest 解析固定 Plan 目标，复用 revision/containment context、
实时 mapping projection 和最新串行/并行 run 完成校验；在全部条件通过后仅写入 `status: done`。
沿用受信任本地 workspace 边界，不增加 native helper、跨进程事务或对抗性 ancestor-swap 承诺。

Plan artifact revision 包含 status，完成操作会使旧编辑 revision 失效；run 输入比较只将 done 归一到 approved，
保持原快照与 digest 不变，其他输入变化仍阻止完成验证。done 仍可读取、生成 Report 和幂等 materialize，
不能修订、重新批准或创建新 run。完成资格不接受 partial；Report 独立保留其 partial 工作流。
read-pages 提供计算得到的 Plan revision；Web 以已加载 revision 提交，冲突要求刷新再操作，成功后重读计划和项目摘要。


## Workspace skill 分发与 Pi 发现

`src/skills/skillInstall.ts` 持有安装、状态查询和有限写入，`useCases/skillCommand.ts` 负责 CLI 参数与收据；init 复用同一 adapter。
`scripts/buildSkill.mjs` 在 build 时从唯一可编辑来源 `skills/projectops-workflow/` 和 `docs/AGENT_CONTRACT.md` 操作章节
生成 `dist/skills/bundle.json`，只改写分发相对引用，不手工维护命令/schema 副本。安装不读取源码 checkout。
`npm pack` 的 prepack 构建并仅分发 dist。bundle source 为 `projectops/skills/projectops-workflow`，
排序文件映射的 SHA256 为 distribution_id；`.projectops-install.json` 保存同一 ID 和逐文件摘要。

安装预检静态目录和普通文件，拒绝 symlink；排他空锁目录限定在 `.agents/skills/.projectops-workflow.lock`。
更新只覆盖完整受管内容；本地修改或损坏安装要求显式 replace 与现场 content_id。逐文件移入唯一备份目录并核验移走的内容，
再以 `wx` 发布，避免普通编辑器或其他安装器竞争时静默覆盖。新文件竞争失败保留对方目标；移走后发现漂移则尝试
hard-link no-clobber 恢复，失败仍保留备份与对方目标。记录最后写入；部分完成不是事务，收据公开 changed/backups 与恢复步骤。
建锁错误区分 EEXIST 占用与 EPERM/EACCES 权限失败；未取得锁的失败不释放或清理对方锁，权限诊断不建议删除锁。
旧版多余文件、无关内容和备份不自动删除；中断遗留锁需确认无活动安装器后人工移除空目录。
安全边界分别为静态 containment、正常并发 no-clobber；不要求同用户恶意 ancestor-swap resistance。
维持受信任本地 Linux、Node.js 22+、无 native helper，不扩展其他平台或自动 crash recovery。

Pi 集成以安装的 0.85.0 类型声明及源码为准，并核对
[官方 skills 发现说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md) 与
[官方 SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)（2026-09-06）。
默认祖先发现不能保证越过子 Repo 的 Git root；`createPiResourceLoader` 用 SDK `loadSkills` 读取安装文件，
通过 `DefaultResourceLoader.skillsOverride` 合并并按名称保留 workspace 来源，避免与全局/Repo 同名入口重复。
生产 openPiSession 直接使用该 loader，进展记录实际 filePath。已存在安装必须与当前 bundle 匹配，否则给出恢复诊断；
缺失安装仍可按原有 Pi 配置工作。测试使用真实 SDK ResourceLoader/read/bash，从登记 Git 子 Repo、深层 cwd 和 workspace root
读取安装入口与相对契约并完成 project list，明确没有调用模型；不据此声称其他 Agent 自动发现受支持。

`tests/skill-install.test.ts`、`skill-package.test.ts`、`skill-write-safety.test.ts` 与 `pi-skill-discovery.test.ts`
覆盖 built CLI 默认/跳过/补装/no-op/内容更新/冲突、隔离 npm 包引用闭合、部分 I/O 失败重试、正常并发编辑与 Pi 真实发现。

## 开发服务配置边界

`catalog/workspace.ts` 的项目登记包含可选 `dev`；`dev/config.ts` 提供 descriptor 类型、纯结构校验与受限变量替换，
`workspaceStore` 在读取 manifest 时校验结构。`application/devApi.ts` 为 CLI 与后续运行层共享配置解析、
静态 realpath containment、workspace 内端口冲突和异步端口预检；返回已解析 argv、绝对 cwd、显式环境变量与诊断。
`OwnedDevEndpoint` 由实际持有进程的运行层提供，不能从 PID 文件或端口占用推定归属；配置层自身没有 manager。
`workspaceInspection` 复用不探测端口的校验。真实 CLI 使用 `runAsyncCli` 分发异步 dev 命令，既有 `runCli` 同步接口保留。

本能力独立于 Pi、Workbench 与 Workspace Control。当前配置读操作仅承诺受信任本地 Linux workspace 的静态 symlink
containment；不抵抗恶意 ancestor swap，不使用 native helper。bind 预检释放 socket 后仍存在正常端口竞争窗口，
实际启动还须由服务的 strict-port 行为报错，不能将预检成功解释为持有端口。


`application/devControl.ts` 暴露 controlDevProject/checkManagedDevProject，CLI 和 Web adapter 共享
`dev/client.ts` 的 Unix IPC。`dev/manager.ts` 是固定 canonical workspace 的独立 Node 入口，
由显式 start 排他创建 lock.json 后 bootstrap；它不是业务 CLI subprocess，不加载 Pi/Workbench。
IPC 验证协议版本、workspace 和启动 instance；固定动作只接受项目 ID，不接受命令、环境或 workspace 覆盖。
每个项目 mutation 串行执行；不同项目拥有独立进程组。`dev/runtime.ts` 保存 child handles、pgid、
配置快照、状态与有界日志；以 Linux `/proc` 检查非 zombie 组成员，leader exit 不等于后代退出。

`.pops/runtime/dev` 的目录与固定文件拒绝静态 symlink，lock 使用 exclusive create 保证正常并发单 owner；
socket 权限 0600，文件写入保持在固定 runtime 目录。ledger 用同目录排他临时文件加 rename 发布，
只是最后 ownership 诊断，不是恢复 authority。manager TERM/INT 清理实际拥有的组；异常消失保留 unknown，
不信任遗留 PID、不从端口空闲推断所有后代已退出。支持本地 Linux/Node.js 22+，不使用 native helper，
不承诺 adversarial ancestor swap、跨平台等价或自动崩溃恢复。

`server/devRoutes.ts` 将固定 workspace 下的 `GET/POST /api/projects/:id/dev` 转为共享 devControl 调用，
不创建第二套 runtime 或调用 CLI subprocess。GET 返回配置可用性、承载页面标记、DevStatus 与配置诊断，
不探测/占用端口、不 bootstrap manager，也不泄露 argv/cwd/env。POST 仅接受 start/stop/restart 动作；沿用
Origin、JSON、body 上限与错误 envelope。返回的 endpoints 优先保留 manager 的运行配置快照。
当前 manifest endpoint 端口匹配实际 server 端口时阻止网页 stop/restart，loopback host 别名不会绕过；
未登记或代理入口不在识别保证内。Workbench close 不调用 manager stop。
`web/devUi.ts` 维护独立局部查询与操作状态，按项目代次隔离响应、串行提交，并以局部轮询保留焦点和诊断展开状态。

## 跨项目依赖的身份与消费者

`backlog/dependencyReference.ts` 提供纯 `TaskReference`、`parseTaskReference`、`parsePlanDependency` 和
`taskReferenceKey`。Backlog 裸 ID 在所属项目解释，限定 `project:ID` 显式定位项目；Plan 裸小写 key
表示草案局部节点，既有任务必须使用限定引用。项目语法与 manifest 共用 `catalog/workspace.ts` 的
`isProjectId`。parser 不进行 I/O、不验证注册或存在性；完整身份供去重、循环检测与链接使用。
各消费者共用引用身份与应用层校验，职责如下。

| 消费者 | 当前职责 |
|---|---|
| `backlog/item.ts`、`backlog/add.ts`、`application/backlogApi.ts`、`useCases/backlogAdd.ts`、`useCases/backlogUpdate.ts` | 保持 Markdown string[] 读写；共享应用层按 manifest 解析目标，创建/替换/移除依赖，revision、自依赖、同身份重复和可达跨项目循环校验；外部只读 |
| `plan/plan.ts`、`useCases/planMaterialize.ts`、`application/planRevision.ts` | 区分局部拓扑和既有引用；物化保留限定引用，mapping 只拥有本项目新项；修订复用受控同步及输入保护 |
| `application/planNext.ts`、`application/planExecution.ts`、`application/workbenchReadModel.ts` | 共享完整引用解析与满足规则，直接前置当前状态/接受/landed 诊断；进度仅统计 mapping，自身无 ready 不等于 completed |
| `application/planRunApi.ts`、`planRun/planRun.ts` | 串行快照中的依赖保持项目身份与满足证据；只创建自身节点，派发前复核外部事实并保留本地接受/reuse 规则 |
| `application/parallelRunApi.ts`、`planRun/parallelRun.ts` | 外部前置不加入本 Repo DAG 节点；重验依赖与冻结证据，保持本地 landed 与资源门禁 |
| `execution/attempt.ts`、`execution/store.ts`、`application/verificationChecks.ts` | 按目标项目读取受管接受及对应输入/验证；并行成果同时检查 landed，不把模型成功当接受 |
| `useCases/reportGenerate.ts`、`report/report.ts` 与两类 run 的 delivery evidence 查询 | 上游引用与证据属于前置说明，不能计入本 Plan 已交付任务；发布时再次检查有效性 |
| `web/backlogView.ts`、`web/backlogController.ts`、Plan 阅读/修订与 HTTP adapter | 复用 typed application API，选择器区分项目/局部 key，支持 revision 编辑和真实项目导航，正反向关系暴露局部读取 diagnostics |

`application/backlogDependencies.ts` 已提供 `readTaskReference`、`validateBacklogDependencies` 和
`getBacklogDependencies`。创建通过 `createBacklogItem` 把共享验证注入 `backlog/add.ts`，编辑复用
`updateBacklogItemContent` 的 revision 与 receipt；CLI 和 HTTP 使用相同 application 入口。
引用读取复用 `resolveBacklogContext` 的 manifest/store identity 与静态 containment 检查；验证只遍历
变更节点可达的链，以完整项目身份检测重复、自依赖和环，外部任务保持只读。
直接查询返回解析成功项、当前满足原因和逐引用 diagnostics；反向扫描保留可读结果并以 complete=false 暴露局部损坏。

应用层共享直接依赖事实查询：manifest 路由到目标 Backlog 与 executions，返回身份、条目、
满足条件及可定位诊断。循环校验单独遍历变更节点可达图，反向查询显式遍历已登记项目；二者不混入
普通 next 的直接前置查询。运行与 Report 在消费时重新验证冻结依据，外部变化不隐式刷新执行输入。
详细生命周期、取消/不可读处理、无迁移联合语法和安全边界见 PRODUCT_SPEC 的“跨项目任务依赖契约”。


`application/dependencyReadiness.ts` 统一直接前置的当前状态、最新 attempt 接受、durable verification 与并行 landed 校验。
`freezeDependency` 返回完整引用、任务输入、依据类型、attempt/snapshot/verification/landing 摘要；
`validateFrozenDependency` 在运行派发、恢复和完成时重验。串行本地 reuse 继续使用原 acceptedAttempt 与基线，
并行本地节点继续等待 landed；外部引用只加入已满足前置集合，不生成外部节点。
`readPlanPrerequisites` 为 execution projection、Plan complete 和 Report 发布提供非 mapping 前置，
Report 仅把它们作为 verification 说明，不扩大交付任务集合。

验收使用 `tests/browser/three-project-delivery.spec.ts` 贯通设施 → 服务 → 产品的 CLI 创建、依赖编辑、混合 Plan 物化、刷新解锁及跨项目返回。`backlog-dependencies`、`plan-dependencies`、`dependency-evidence`、`cross-project-readiness` 与两类 run 测试分别覆盖 revision/循环、引用保留、接受/landing 和冻结证据失效；同项目既有测试继续作为回归门禁。全部 fixture 位于隔离临时 workspace，测试结束清理，不写真实项目。


## Plan 跨项目物化身份基础

`plan/planIdentity.ts` 将可选 item project、mapping 的相对/限定字符串和 Backlog source
统一解析为明确项目身份。`plan/plan.ts` 保留当前 `plan/Plan@1`，新增可选 `project` 与
`materialization.state: partial`；省略 state 的完整 mapping 必须覆盖全部 key，done 不接受 partial。
这是当前联合语法的扩展，不引入旧 schema fallback 或活动数据迁移。

`application/planDependencies.ts` 校验显式目标 store、同目标 parent 与既有 mapping 的项目不变，
局部节点及修订 pending 节点按真实项目构图。未显式指定项目的普通草案继续允许在 owner Backlog
初始化前创建；物化写入前必须预检全部目标。普通修订拒绝 partial 和目标迁移。

后续接入点及责任如下（本阶段仅建立身份基础）：

| 消费者 | 完整身份与 partial 的接入责任 |
|---|---|
| `useCases/planMaterialize.ts` | 按目标 store 写入、限定来源、逐项证据与恢复、完整 no-op |
| `application/planExecution.ts`、`planNext.ts`、`dependencyReadiness.ts` | 映射项真实项目读取、完整身份去重、外部依赖不计进度 |
| `application/planRevision.ts` | 各目标 store revision 与执行历史、实际已应用范围 |
| `application/executionApi.ts` 及 execution 输入解析 | 任务真实 Repo 与来源 owner Plan |
| `application/planComplete.ts`、Report generation | 各任务验收及 landing 证据、owner Report、partial 拒绝 |
| 串行及并行 run API | 在任何运行副作用前拒绝跨 owner mapping 和 partial |
| Workbench Plan、Backlog、Report 及导航 | 显示目标项目、真实项目链接、跨项目来源返回 |

所有入口应通过 `planMappingReference(owner, value)` 与 `parsePlanSource(value, itemProject)`
取得完整身份，不通过字符串拼接或任务 ID 前缀推断项目。


### 跨 store 物化与恢复

`useCases/planMaterialize.ts` 先解析所有 manifest 目标 store 并校验静态路径 containment 与依赖，
再按拓扑调用共享 Backlog add。`backlog/add.ts` 的逐项写后回调在索引更新之前记录完整 mapping，
使索引写失败仍能返回已创建事实。Plan 每次保存前重读 revision；发现其他编辑时停止。
`plan/materializationRecovery.ts` 用唯一 source 和项目、标题、类型、parent、依赖、正文核对已有条目，
匹配时复用并重建索引，冲突时返回诊断。Plan 写失败而来源仍存在的重试沿用同一路径，不盲重建。
这些检查遵循受信任本地 workspace 边界，不提供跨 store 事务或恶意并发防护。
