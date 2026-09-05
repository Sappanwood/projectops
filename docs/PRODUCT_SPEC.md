# ProjectOps 产品规格

## 产品概述

ProjectOps 是面向人类开发者和 Coding Agent 的本地 Project Operations 产品。它以 Git-friendly 的
Markdown/JSON artifact 为权威数据，通过统一 `pops` CLI 和 Local Web Workbench 管理项目工作流。

当前阶段目标是快速验证核心闭环，不提供现有 Workspace Control 的兼容层和迁移工具。

## 目标用户与使用场景

- 单机维护多个代码项目的开发者。
- 需要稳定、机器可读任务和计划契约的 Coding Agent。
- 希望把计划、任务、交付证据和工作流改进保留在 Git 中的团队。

核心场景：

1. 初始化一个 workspace 并显式登记 Repo（`pops init` + `pops project add`，两个动作分离）。
2. 创建和推进 Backlog item。
3. 编写、验证和批准 Plan，并 materialize 为 Backlog。
4. 在 delivery 结束后生成 Report。
5. 建立和检查 Repo 长期文档体系。
6. 记录、分类并处理 Workflow Retrospective。

## 核心功能

| 模块 | 目标能力 | 当前状态 |
|---|---|---|
| Workspace/Catalog | 初始化、项目注册、typed roots、doctor | 已实现（init、project add/list/doctor） |
| Backlog | Store bootstrap、CRUD、dependency、queue | 部分实现（init/add/list/show/update 与 depends_on 存储；queue 未实现） |
| Plan | authoring、查询、validation、review、approval、materialization | authoring/query/validation/approval/materialization 已实现 |
| Report | delivery evidence 生成和关联 | 部分实现（Report@1 schema/storage、单 Plan 生成资格校验与 `pops report create/list/show`；已覆盖 completed/partial/no-clobber CLI smoke） |
| Project Docs | roles、templates、scaffold、check | scaffold/check 已实现 |
| Retrospective | workspace 级 Markdown 记录、inbox/active/archive store 与派生索引 | 已实现（Retrospective@1、Store@1、manifest 路由、`pops init` bootstrap、`pops retrospective capture/list/show/triage/archive` 与 revision 保护；Workbench 只读列表、过滤与详情已实现） |
| Workbench | 统一浏览和受控写入 | Backlog 可写切片已实现（完整列表、详情、revision-protected 状态更新与冲突重试）；Plan、Report、Docs、Retrospective 完整只读视图已实现；Chromium 浏览器 E2E 已覆盖启动、导航、读写和失败路径 |
| CLI bootstrap | `pops --help`、`pops --version` | 已实现 |

## 数据契约原则

- Workspace topology、Backlog、Plan、Report、Docs 和 Retrospective 使用独立 versioned schema。
- 不建立覆盖所有 artifact 的通用 schema 或生命周期。
- 跨领域关联使用稳定 logical URI，不把机器绝对路径写入 artifact。
- Plan 使用 `plan/Plan@1` JSON artifact：包含稳定 ID、标题、目标及以局部 key 关联的 Backlog item 草案，并以 `status: draft|approved` 表示生命周期；草案可用 `parent` 和 `depends_on` 引用其他局部 key。批准 Plan 额外包含一次 `approval` 记录（`approved_at` 与 `review_note`）；materialize 后增加 `materialization` 记录（`materialized_at` 与 `mapping`），保存局部 key 到 Backlog ID 的映射。
- `pops plan materialize` 只接受通过 schema/依赖校验且 status 为 `approved` 的 Plan；按 parent/dependency 拓扑创建同一 project 的 epic/task，JSON 输出 mutation receipt。已有完整 mapping 的重试为 `no_op`，不创建或改写条目。
- 派生索引和未来 UI preference 不得成为业务 authority。
- Workbench Read Model 是按请求从现有领域读取能力组合的 projection：workspace overview 返回 workspace identity、
  project summaries 与 doctor diagnostics；project overview 返回 Backlog 状态计数/最近条目、Plan/Report 摘要、
  Docs check 与 project-scoped Retrospective 状态计数。单个 malformed artifact 或不可用领域以结构化 diagnostic
  呈现，不改变 Markdown/JSON authority，也不在输出中增加机器绝对路径。
- Local Workbench HTTP server 由启动参数固定一个 workspace，默认只绑定 `127.0.0.1:7331`，并以稳定 JSON
  envelope 暴露 workspace/project overview 与 Backlog list/show/update。HTTP 请求不得携带 workspace path；
  Backlog update 只接受 JSON `status` 和可选 `expected_revision`，stale revision 返回 conflict，不写入旧状态。
  mutation 拒绝非 JSON content type 和非同源 browser Origin；错误不暴露 stack trace 或机器绝对路径。
- Workbench 的 `GET /api/projects/<id>/read-pages` 返回独立 typed projection：完整 Plan、Report、固定文档检查结果和
  workspace Retrospective 记录；不接受 query 参数、文件路径或 mutation。Plan 可展开 goal、status、approval、
  materialization mapping 和带 parent/dependencies 的 item；Report 可展开 outcome、Plan/Backlog references、
  verification、deviations、workarounds、repo docs 与 Markdown 正文。正文按转义的源文显示。
- Docs 页面始终列出共享 Docs domain 的四个固定路径及各自检查结果，不 scaffold、不修改文件。
  Retrospective 页面读取完整 workspace 列表，默认过滤当前 project；status/project/task 支持组合精确过滤，
  project/task 留空表示全部，`null` 表示未记录的 provenance。结果按 inbox/active/archive 分组，详情包含完整
  metadata、revision 和正文；malformed diagnostics 不因过滤而隐藏。四个领域均显示空状态或读取诊断，顶部
  Refresh 重读 authority；读取失败可重试，项目切换丢弃旧请求响应。
- Workspace 是聚合父目录，project 必须是其子路径；workspace 根自身不可登记。
- Workbench Backlog 按状态分组、组内按 ID 稳定排序，显示全部 item；详情包含 title、priority、status、
  dependencies、revision 和转义后的 Markdown 源文。界面只提供 `todo|in_progress|done` 状态操作，
  每次提交均携带已加载的 revision；成功后重读列表、详情和项目摘要。冲突不自动重试，保留当前 item
  并要求用户刷新后重新提交。读取失败、未知 item、非法输入均显示错误反馈。
- 未完成或缺失的依赖依据同一 Backlog 列表显示提示；当前 CLI 不强制按依赖阻止状态更新，Web 保持一致，
  不持久化派生依赖状态。共享 Backlog parser 拒绝非字符串列表元素、非法标量类型和非法状态等 malformed 数据。
- Workspace 可在非空目录初始化，但不得覆盖已有 manifest 或其他用户内容。
- 登记不强求 git repo，任意目录均可登记；重复登记报错。
- Project Docs scaffold 为每个已登记 project 提供固定的 README.md、AGENTS.md、docs/PRODUCT_SPEC.md 和 docs/ARCHITECTURE.md 模板；模板包含角色标题和待填写提示，不支持外部模板源或自定义变量。
- scaffold 预检固定写入目标，已有普通文件保持字节不变并记入 `skipped`；新建文件记入 `created`，JSON receipt 不包含绝对路径。
- scaffold 的写入目标限制在已登记 project 的 canonical 路径内；目标为非普通文件或 docs parent 越界时返回错误，不产生部分 scaffold。
- `pops docs check` 只读检查同一固定文档集合：每个目标必须是普通文件并包含客观可识别的 Markdown 一级标题；缺失、非普通文件或缺少标题时返回非零，并在 `--json` 的 `problems` 数组中按固定路径顺序返回全部诊断。
- docs check 不检查链接完整性、内容新鲜度、措辞质量或跨文档语义一致性。
- Report 使用独立的 `report/Report@1` Markdown artifact，记录稳定 ID、标题、project、生成时间、`completed|partial` outcome、Plan logical reference、Backlog 状态结果、验证证据、偏离、workaround 和 Repo 文档 repo-relative logical references（例如 `README.md` 或 `docs/ARCHITECTURE.md`）；Report 文件只在已登记 project 的 reports root 内创建，并拒绝覆盖既有文件。
- Report 生成只接受已持久化、已批准且已 materialize 的单份 Plan，并从同一 project 的 Backlog mapping 读取实际状态；只有所有 task 为 `done` 时生成 `completed`，未完成 task 必须经过显式且带非空说明的 partial 接受。
- Retrospective 使用独立的 `retrospective/Retrospective@1` Markdown 记录和 `retrospective/Store@1` store；记录至少包含 `id`、`created_at`、`project`、`task`、`trigger`、`status`、`harness`、`model` 与 Markdown 正文，其中 `project`、`task` 在 provenance 不可用时可显式为 `null`，但缺失字段仍无效。分类后可附带 `disposition`、`owner_scope`、`categories`、`next_action` 和 `related_info`；结案后可附带 `action_disposition`、`actioned_at`、`backlog` 和 `resolution_note`。每个 workspace 的 `.pops/workspace.json` 以顶层 `retrospectives` descriptor（`type: workflow/retrospectives@1`、相对 `root`）表达唯一 workspace-level root；`pops init` 创建该 store。权威记录分别位于 `inbox/`、`active/`、`archive/`，`index.json` 与 `INDEX.md` 可从 Markdown 重建。
- `pops retrospective capture` 接受调用方提供的 trigger、harness、model（不可得时为 `null`）、可选 project/task 和 Markdown body，只在 `inbox/` 创建新记录；body 必须包含三个非空 Markdown section：`Hidden friction encountered`、`Workarounds used` 和 `Improvement candidates`。输出包含相对 path 与文件内容 sha256 revision。显式 ID 与自动 ID 在共享锁内跨三个状态目录保持唯一，自动 ID 的 suffix 覆盖 active/archive 和此前重试；`list` 支持 status/project/task 过滤并以稳定 path 顺序返回，`show` 返回完整 metadata、revision 和正文。malformed Markdown 在 list 的 diagnostics 中暴露；capture 失败不保留新文件或派生索引漂移。capture 不推断 provenance、不自动分类或执行生命周期流转。
- `pops retrospective triage <id>` 只允许 `inbox → active|archive`，显式要求 `--to`、当前文件的 `--expected-revision` 和非空 `--next-action`，并持久化 disposition、owner scope、categories、next action 和 related info；`pops retrospective archive <id>` 只允许 `active → archive`，要求当前 revision，并持久化 action disposition、actioned_at、backlog links 和 resolution note，同时保留记录已有的 next action；`--backlog` links 必须是 `project-ops:backlog/items/<PREFIX>-NNN.md`，prefix 依据各 project store 的通用 ID 规则。目标已存在、状态非法或 revision 过期时失败且保持源文件不变；成功流转后 source/target 只保留一份 authority，并重建 `index.json` 与 `INDEX.md`。共享锁位于 `.pops/runtime/retrospectives/`，不污染版本化 artifact root。

## Alpha 产品约束

- 只支持受信任的本地用户和 workspace。
- 优先正确工作流，不承诺完整非法输入处理。
- 不承诺 crash consistency、跨进程事务或对抗性并发安全。
- 不承诺旧版本 schema、现有 Workspace Control 或其他 Project Ops layout 的兼容。
- 真实用户问题出现后再增加 edge-case 行为和回归测试。

## 演进路线

1. ~~Workspace/Catalog 与 Backlog 纵向闭环。~~（基础版已交付：init、显式 project 登记、doctor、backlog store 与 CRUD、状态流转）
2. Plan、Project Docs 和 materialization。（Plan 到 Backlog materialization 已实现。）
3. ~~Report 与 Retrospective 闭环。~~（Report 与 Retrospective 的 CLI 纵向闭环已实现；Workbench 只读视图已实现。）
4. ~~Local Web Workbench。~~（Backlog 首个可写切片已完成；Plan、Report、Docs、Retrospective 完整只读视图已完成；Chromium 浏览器 E2E 已覆盖启动、导航、读写和失败路径。）
5. 安装发行、升级和按真实需求补充 hardening。
