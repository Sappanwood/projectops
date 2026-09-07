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
| Backlog | Store bootstrap、CRUD、dependency、queue | 初始化代号支持 workspace 内查重及自定义；已有状态与内容编辑、revision 保护、depends_on；全局 queue 未实现 |
| Plan | authoring、查询、validation、review、approval、materialization、修订 | 已实现创建、校验、批准、物化、下一步查询及 preview/confirm 修订 |
| Report | delivery evidence 生成和关联 | 部分实现（Report@1 schema/storage、单 Plan 生成资格校验与 `pops report create/list/show`；已覆盖 completed/partial/no-clobber CLI smoke） |
| Project Docs | roles、templates、scaffold、check | scaffold/check 与 Workbench 文档阅读已实现 |
| Retrospective | workspace 级 Markdown 记录、inbox/active/archive store 与派生索引 | 已实现（Retrospective@1、Store@1、manifest 路由、`pops init` bootstrap、`pops retrospective capture/list/show/triage/archive` 与 revision 保护；Workbench 只读列表、过滤与详情已实现） |
| Workbench | 统一浏览和受控写入 | Backlog 可写切片已实现（完整列表、详情、revision-protected 状态更新与冲突重试）；Plan、Report、Retrospective 阅读视图及 Docs 文档阅读与导航已实现；Chromium 浏览器 E2E 已覆盖启动、导航、读写和失败路径 |
| Execution | 尝试记录、运行控制、验证与验收 | 已实现外部工作 CLI 记录、Pi 单任务 runner、进展/追加指示、Web 控制与显式验收 |
| CLI bootstrap | `pops --help`、`pops --version` | 已实现 |

## 数据契约原则

Overview 桌面采用两列，按 Plans、Backlog、Reports、Retrospectives 排列，Project Docs 独占末行；
小于 1024px 时按相同顺序单列展示。卡片高度随内容增长，标题完整换行，状态/时间与 ID 分行，
长 ID 允许断行，不使用卡片内部滚动条。五类面板提供一致的“查看全部”入口，日期按浏览器本地时间显示。
任务、计划、报告和回顾标题使用真实详情链接，支持新标签页、刷新定位及返回 Overview；
返回时重读项目摘要并在当前会话内恢复来源滚动位置，回顾列表和详情入口携带项目筛选。
Plans 将未完成（含草案、未物化和零 task）放在全部 task 已完成的计划之前，同组按 ID 排序；
计划状态与从当前 Backlog 计算的 task 完成数/百分比分开显示，缺失映射保留分母和诊断。
Backlog 优先展示进行中、待办，再按优先级与 ID 排序；没有活动条目时提示并展示最近更新，
按更新时间倒序、ID 升序。Reports 按实际生成时间倒序、ID 升序，保留历史交付结果。
以上三类列表最多预览五条，显示预览数与对应范围总数；读取异常时标注数量仅代表已读取记录，保留可读内容。
Retrospectives 仅统计当前项目，按创建时间倒序、ID 升序预览五条，采用相同计数/诊断提示。
摘要从正文首段有效文本派生，去除标题、围栏代码和基本 Markdown 标记，最多 160 个字符，超出显示省略号；
无有效文本时以 ID 回退。ID 位于次级信息行，文件路径不进入卡片；完整正文通过详情链接访问。
Project Docs 提供四份标准文档直达入口，逐项显示可读性与检查问题；不可读目标显示原因，
可读但缺少一级标题的文档仍可打开。标准检查只覆盖文件类型和一级标题，不代表内容新鲜度或语义正确性。

- Workspace topology、Backlog、Plan、Report、Docs 和 Retrospective 使用独立 versioned schema。
- 不建立覆盖所有 artifact 的通用 schema 或生命周期。
- 跨领域关联使用稳定 logical URI，不把机器绝对路径写入 artifact。
- Plan 使用 `plan/Plan@1` JSON artifact：包含稳定 ID、标题、目标及以局部 key 关联的 Backlog item 草案，并以 `status: draft|approved|done` 表示生命周期；草案 `parent` 引用局部 epic key，`depends_on` 可混用局部 task key 与同 workspace 既有 task 的 `project:ID` 限定引用。批准 Plan 额外包含一次 `approval` 记录（`approved_at` 与 `review_note`）；materialize 后增加 `materialization` 记录（`materialized_at` 与 `mapping`），保存局部 key 到 Backlog ID 的映射。
- `pops plan materialize` 只接受通过 schema/依赖校验且 status 为 `approved` 的 Plan；按 parent/dependency 拓扑创建同一 project 的 epic/task，JSON 输出 mutation receipt。已有完整 mapping（含 `done` Plan）的重试为 `no_op`，不创建或改写条目。
- Plan 完成采用显式 `approved → done`：CLI `pops plan complete` 和 Web“标为完成”共用 application 校验，必须携带当前 Plan revision。
  要求已物化、至少一个 task、全部映射可读且全部 task 为 done；epic 不要求 done。若有串行/并行执行记录，最新记录须通过现有完成与验收/落地证据校验。
  成功只更新 Plan status，保留批准、mapping 和输入；同 revision 的 done 重试为 no_op。未完成、无法读取和 revision 冲突不写文件。
  done 显示“已完成”，不能重新批准、修订或创建新 run；新增范围另建后续计划。Backlog 后续变化不自动撤销 done，实时进度仍独立展示。
  Report 继续从实时 Backlog 与执行证据校验，接受 approved 或 done Plan；生成报告不会自动标记完成，partial 也不允许跳过完成条件。
- Backlog 初始化支持 `pops backlog init <project> [--id-prefix <PREFIX>]`。自定义代号仅接受非空 ASCII 大写字母和数字，不改大小写、去空白或替换非法输入；沿用 Store@1，无额外长度限制。
  自动 base 为 project ID 去连字符、取前三位并转大写，按 `base`、`base2`、`base3`……选择第一个未占用值；mochi 先得到 `MOC` 后，mochi-write 自动得到 `MOC2`。显式指定 `MWT` 后，add 从 `MWT-001` 编号。
  查重仅使用当前 ProjectOps manifest 登记项目的已初始化 Backlog store，不跨 workspace、不扫描 Workspace Control 或未登记目录，不为尚未初始化项目预留代号。
  只有可读取 root 中 `backlog.json`、`items/`、`INDEX.md` 均不存在时才视为未初始化；不可读取、缺失或部分 store、非法 schema/prefix、project_id 不匹配均阻止创建，并指出项目、位置和恢复原因。
  自定义冲突明确指出占用项目；输入或查重失败不创建目标 store 文件。已有 store 和 ID 保持不变，重复 init 拒绝覆盖，即使 store 尚无条目也不借 init 改名；历史重复代号不自动修复或迁移。
  同 workspace 的初始化以短时排他锁协调正常并发，锁占用时明确失败并可重试；不承诺与手工改写/项目注册并发、崩溃恢复或对抗性 ancestor swap。完整参数、收据及锁恢复见 [Agent 操作契约](AGENT_CONTRACT.md#backlog初始化与代号)。
- 派生索引和未来 UI preference 不得成为业务 authority。
- Workbench Read Model 是按请求从现有领域读取能力组合的 projection：workspace overview 返回 workspace identity、
  project summaries 与 doctor diagnostics；project overview 返回 Backlog 状态计数/最近条目、Plan/Report 摘要、
  Docs check 与 project-scoped Retrospective 状态计数。单个 malformed artifact 或不可用领域以结构化 diagnostic
  呈现，不改变 Markdown/JSON authority，也不在输出中增加机器绝对路径。
- Local Workbench HTTP server 由启动参数固定一个 workspace，默认只绑定 `127.0.0.1:7331`，并以稳定 JSON
  envelope 暴露 workspace/project overview 与 Backlog list/show/update。HTTP 请求不得携带 workspace path；
  Backlog update 接受状态更新，或携带 `expected_revision` 的 `title`/`body` 内容更新；两者不可混合，stale revision 返回 conflict，不写入旧状态。
  mutation 拒绝非 JSON content type 和非同源 browser Origin；错误不暴露 stack trace 或机器绝对路径。
- Workbench 的 `GET /api/projects/<id>/read-pages` 返回独立 typed projection：完整 Plan、Report、固定文档检查结果和
  workspace Retrospective 记录；不接受 query 参数、文件路径或 mutation。Plan 可展开 goal、status、approval、
  materialization mapping 和带 parent/dependencies 的 item；Report 可展开 outcome、Plan/Backlog references、
  verification、deviations、workarounds、repo docs 与 Markdown 正文。Report 正文默认渲染，支持源码切换；技术记录折叠，关联 Plan、Backlog 与 Repo 文档支持跳转和返回。
- Plan 阅读页突出标题、计划状态与目标，长目标默认显示三行并可展开全文，提供带序号、标题和依赖的任务目录；点击目录定位并展开对应任务。
  任务正文独立展开，审批和 mapping 收入次级记录区；不展示不存在的审批字段。刷新保留展开状态。
- Plan 的执行进度来自同项目 materialization mapping 对应的实时 Backlog；显示 task 总数、todo、in_progress、done 与无法读取数量。
  epic 不计入完成率；缺失/损坏任务保留在分母，逐项显示 ID、计划标题回退与诊断，有效条目显示实时标题及状态。
  已有 blocked/cancelled 状态按原值显示和计数，均不算完成。未物化显示未开始执行；零 task 显示无可执行任务，二者完成百分比均为 null。
  完成百分比向下取整，只有全部 task done 才显示 100%。刷新重新读取 Backlog，计划状态与执行进度分开呈现，进度查询不自动修改 Plan 生命周期。
- Docs 页面提供四份标准文档入口及检查结果，同时列出 Repo `docs/` 下其他 Markdown。正文经独立 API 按需读取，不 scaffold、不修改文件。
  Research 页面从 manifest 的 `markdown/research@1` root 枚举 Markdown 并提供列表、正文、章节目录和返回导航；root 不可读取或 descriptor 不匹配时展示诊断，空 root 展示空状态。
  Retrospective 页面读取完整 workspace 列表，默认过滤当前 project；status/project/task 支持组合精确过滤，
  project/task 留空表示全部，`null` 表示未记录的 provenance。结果按 inbox/active/archive 分组，详情包含完整
  metadata、revision 和正文；malformed diagnostics 不因过滤而隐藏。四个领域均显示空状态或读取诊断，顶部
  Refresh 重读 authority；读取失败可重试，项目切换丢弃旧请求响应。
- Workspace 是聚合父目录，project 必须是其子路径；workspace 根自身不可登记。
- Workbench Backlog 按状态分组、组内按 ID 稳定排序，显示全部 item；详情包含 title、priority、status、
  dependencies、revision 和 Markdown 阅读视图；列表突出标题与选中态，详情顶部提供状态操作与刷新，
  revision 收入可展开技术信息。界面只提供 `todo|in_progress|done` 状态操作，
  每次提交均携带已加载的 revision；成功后重读列表、详情和项目摘要。冲突不自动重试，保留当前 item
  并要求用户刷新后重新提交。读取失败、未知 item、非法输入均显示错误反馈。
- Backlog、Plan、Report、Retrospective、Docs 和 Research 共用轻量阅读渲染：标题、段落、嵌套有序/无序列表、强调、
  行内/围栏代码、表格、引用块、只读任务列表、分隔线和 HTTP(S) 外链；不承诺完整 CommonMark。
  原始 HTML 始终转义，图片不加载；Mermaid fenced block 使用本地打包的官方 runtime，以 strict 安全级别渲染，语法错误及图片节点保留源码，浏览器限制外部资源加载。可切换精确 Markdown 源码，长代码/表格局部横向滚动。
  Docs 相对 Markdown 链接在文档范围内解析；Report 支持 Plan/Backlog logical references 与 Repo 文档引用。
  未支持目标保留可读文本及提示，不执行任意 URL。其他页面的本地路径和非 HTTP(S) 链接仍显示文本。
  阅读视图不写 authority；桌面分栏，窄屏纵向排列。
- 未完成或缺失的依赖依据同一 Backlog 列表显示提示；当前 CLI 不强制按依赖阻止状态更新，Web 保持一致，
  不持久化派生依赖状态。共享 Backlog parser 拒绝非字符串列表元素、非法标量类型和非法状态等 malformed 数据。
- Workspace 可在非空目录初始化，但不得覆盖已有 manifest 或其他用户内容。
- `pops init [dir] [--skip-skill] --json` 默认安装 workspace 专用 skill，数据初始化后返回
  `workspace:{name,manifest,initialized:true}` 与 `skill` 状态。安装成功或跳过时 `ok:true`/退出 0；
  skill 冲突或失败时 `ok:false`/退出 1，保留已经可用的数据 workspace 与恢复说明。数据初始化本身失败仍返回 `ok:false,error`。
- 已有 workspace 通过 `skill install/update/status` 补装、更新和只读查询。分发内容 SHA256 独立于 package version；
  完整重复安装可核验 no-op。同名非受管内容、本地修改、缺失文件和损坏记录默认保护，替换必须显式提供
  `update --replace --expected-content <当前快照>`。只处理当前分发文件与记录，保留备份和无关文件。
- 安装位于 `.agents/skills/projectops-workflow/`，包内引用自包含，不安装全局配置。受管 Pi 0.85.0 runner 从登记子 Repo
  和深层目录显式加载 workspace 来源并去重；过期/修改的安装须先恢复。外部 Agent 自动发现尚未验证。
  不承诺跨文件事务或自动崩溃恢复；冲突、部分失败和锁恢复以 Agent 操作契约为准。
- 登记不强求 git repo，任意目录均可登记；重复登记报错。
- Project Docs scaffold 为每个已登记 project 提供固定的 README.md、AGENTS.md、docs/PRODUCT_SPEC.md 和 docs/ARCHITECTURE.md 模板；模板包含角色标题和待填写提示，不支持外部模板源或自定义变量。
- scaffold 预检固定写入目标，已有普通文件保持字节不变并记入 `skipped`；新建文件记入 `created`，JSON receipt 不包含绝对路径。
- scaffold 的写入目标限制在已登记 project 的 canonical 路径内；目标为非普通文件或 docs parent 越界时返回错误，不产生部分 scaffold。
- `pops docs check` 只读检查同一固定文档集合：每个目标必须是普通文件并包含客观可识别的 Markdown 一级标题；缺失、非普通文件或缺少标题时返回非零，并在 `--json` 的 `problems` 数组中按固定路径顺序返回全部诊断。
- docs check 不检查链接完整性、内容新鲜度、措辞质量或跨文档语义一致性。
- Report 使用独立的 `report/Report@1` Markdown artifact，记录稳定 ID、标题、project、生成时间、`completed|partial` outcome、Plan logical reference、Backlog 状态结果、验证证据、偏离、workaround 和 Repo 文档 repo-relative logical references（例如 `README.md` 或 `docs/ARCHITECTURE.md`）；Report 文件只在已登记 project 的 reports root 内创建，并拒绝覆盖既有文件。
- Report 生成只接受已持久化、已批准且已 materialize 的单份 Plan，并从同一 project 的 Backlog mapping 读取实际状态；只有所有 task 为 `done` 时生成 `completed`，未完成 task 必须经过显式且带非空说明的 partial 接受。
- Report 文本允许 Unicode 文字中的斜杠分隔（如“文本/JSON”“编辑/审批”）；独立或有文本分隔符的机器绝对路径仍被拒绝。写入时移除正文末尾空白，保留内部空白；create 收据保留输入正文，show 不返回文件末尾换行。
- Retrospective 使用独立的 `retrospective/Retrospective@1` Markdown 记录和 `retrospective/Store@1` store；记录至少包含 `id`、`created_at`、`project`、`task`、`trigger`、`status`、`harness`、`model` 与 Markdown 正文，其中 `project`、`task` 在 provenance 不可用时可显式为 `null`，但缺失字段仍无效。分类后可附带 `disposition`、`owner_scope`、`categories`、`next_action` 和 `related_info`；结案后可附带 `action_disposition`、`actioned_at`、`backlog` 和 `resolution_note`。每个 workspace 的 `.pops/workspace.json` 以顶层 `retrospectives` descriptor（`type: workflow/retrospectives@1`、相对 `root`）表达唯一 workspace-level root；`pops init` 创建该 store。权威记录分别位于 `inbox/`、`active/`、`archive/`，`index.json` 与 `INDEX.md` 可从 Markdown 重建。
- `pops retrospective capture` 接受调用方提供的 trigger、harness、model（不可得时为 `null`）、可选 project/task 和 Markdown body，只在 `inbox/` 创建新记录；body 必须包含三个非空 Markdown section：`Hidden friction encountered`、`Workarounds used` 和 `Improvement candidates`。输出包含相对 path 与文件内容 sha256 revision。显式 ID 与自动 ID 在共享锁内跨三个状态目录保持唯一，自动 ID 的 suffix 覆盖 active/archive 和此前重试；`list` 支持 status/project/task 过滤并以稳定 path 顺序返回，`show` 返回完整 metadata、revision 和正文。malformed Markdown 在 list 的 diagnostics 中暴露；capture 失败不保留新文件或派生索引漂移。capture 不推断 provenance、不自动分类或执行生命周期流转。
- `pops retrospective triage <id>` 只允许 `inbox → active|archive`，显式要求 `--to`、当前文件的 `--expected-revision` 和非空 `--next-action`，并持久化 disposition、owner scope、categories、next action 和 related info；`pops retrospective archive <id>` 只允许 `active → archive`，要求当前 revision，并持久化 action disposition、actioned_at、backlog links 和 resolution note，同时保留记录已有的 next action；`--backlog` links 必须是 `project-ops:backlog/items/<PREFIX>-NNN.md`，prefix 依据各 project store 的通用 ID 规则。目标已存在、状态非法或 revision 过期时失败且保持源文件不变；成功流转后 source/target 只保留一份 authority，并重建 `index.json` 与 `INDEX.md`。共享锁位于 `.pops/runtime/retrospectives/`，不污染版本化 artifact root。

## Alpha 产品约束

- 真实 dogfooding 仅接入 ProjectOps 自身，暂不接入其他项目；产品的多项目目标和隔离测试不受此限制。
- 新产生的自身 Backlog、Plan 等过程数据以 ProjectOps 为唯一 authority；Workspace Control 的既有条目
  无论是否完成均留在原系统，不属于迁移对象，不双写。
- active item 指 dogfooding 产生且仍在使用的数据，不等同于某个 status。契约变化采用一次性脚本迁移
  实际活动数据，验证内容、状态及引用后删除脚本；不提供旧 schema 读取或长期迁移框架。
- 已完成或归档的数据不要求持续迁移。旧版本无法读取时应明确提示版本不支持，不阻断有效活动数据；
  活动条目对历史数据的引用必须在迁移时明确处理。此项为演进要求，不表示当前已有独立的版本诊断功能。

- 只支持受信任的本地用户和 workspace。
- 优先正确工作流，不承诺完整非法输入处理。
- 不承诺 crash consistency、跨进程事务或对抗性并发安全。
- 不承诺旧版本 schema、现有 Workspace Control 或其他 Project Ops layout 的兼容。
- 真实用户问题出现后再增加 edge-case 行为和回归测试。

## 演进路线

1. ~~Workspace/Catalog 与 Backlog 纵向闭环。~~（基础版已交付：init、显式 project 登记、doctor、backlog store 与 CRUD、状态流转）
2. Plan、Project Docs 和 materialization。（Plan 到 Backlog materialization 已实现。）
3. ~~Report 与 Retrospective 闭环。~~（Report 与 Retrospective 的 CLI 纵向闭环已实现；Workbench 只读视图已实现。）
4. ~~Local Web Workbench。~~（Backlog 首个可写切片已完成；Plan、Report、Retrospective 阅读视图及 Docs 文档阅读与导航已完成；Chromium 浏览器 E2E 已覆盖启动、导航、读写和失败路径。）
5. 安装发行、升级和按真实需求补充 hardening。

## Plan 下一步任务查询

`pops plan next <project> <plan-id> [--json]` 仅查询该 Plan mapping 中的 task。ready 要求任务为 todo，
且每个直接依赖按完整项目身份读取，并满足下文“跨项目任务依赖契约”的当前 done、有效接受及并行 landed 规则；无依赖的 todo 可开始。Plan mapping 外的同项目或跨项目既有任务均可作为前置，
不递归检查依赖的依赖，不查询跨项目队列。in_progress 单独列出，done 排除，epic 不参与推荐；
已有 blocked/cancelled 状态不推荐并给出状态诊断。

成功 JSON 为 `{ok:true,plan_id,ready,in_progress,blocked,next,diagnostics}`。任务摘要包含
id、title、priority、status，blocked 额外包含 reasons（依赖 id、code、message）。ready 按 P0、P1、P2、P3，
再按 ID 字符串排序；next 为首项或 null。进行中、受阻列表采用相同排序。缺失、损坏、项目不匹配的依赖
保留 ID 和原因；映射任务本身不可读则进入 diagnostics。未物化返回空列表、next:null 与 PLAN_NOT_MATERIALIZED
诊断，没有可开始任务仍成功。未知/损坏 Plan、无效 workspace/project 与参数错误返回 `{ok:false,error}`
并退出 1；文本输出表达相同分类与原因。此查询不新增持久化 schema、状态或调度行为。

## Plan 与 Backlog 页面联动

Plan 详情中的“下一步任务”展示共享查询返回的进行中、可开始、受阻列表及依赖原因，排序与 `pops plan next` 一致。
进度和推荐列表中的任务链接进入同项目 Backlog 详情，继续使用现有携带 revision 的状态更新；此导航不自动修改 Plan 或启动执行。
`#/projects/<project>/plans/<plan-id>` 定位并展开 Plan；
`#/projects/<project>/backlog/<item-id>?plan=<plan-id>` 定位任务并保留同项目来源 Plan。
“返回原 Plan”重读进度与推荐，清除旧 projection，展开并定位原计划；手动 Refresh 仍可用，无实时推送。
任务或 Plan 不存在、读取失败时显示错误，任务页保留返回入口；切换项目或详情时丢弃旧请求响应。
导航只改变 URL 与内存视图，不写入 artifact 或持久化导航状态。

## Plan 交付报告关联

Plan 通过同项目 Report 的 `plan` 精确等于 `project-ops:plans/<plan-id>.json` 关联报告，
展示全部匹配记录的 ID、title、outcome、created_at，按生成时间降序、相同时间按 ID 升序排列。
任务完成情况与报告状态独立：全部 task done 且没有报告时显示“任务已完成，尚无交付报告”；
未完成且已有 partial 报告仍保留实际进度。报告仅代表创建时快照，后续 Backlog 变化不改写其内容或 outcome。
损坏 Report 在 Plan 页与 Reports 页保留读取诊断，不阻断有效报告。
报告链接使用 `#/projects/<project>/reports/<report-id>?plan=<plan-id>`，支持直接定位、刷新、返回原 Plan；
失效目标显示错误并保留返回入口。页面没有报告创建按钮或 Report 写接口，报告仍通过 CLI 根据真实状态与验证证据创建。

## Docs 阅读与跨页导航

`GET /api/projects/<id>/docs` 返回 `{ok:true,data:{documents,diagnostics}}`：documents 为 path、standard、issue，
四份标准文档固定在前，扩展 Markdown 按目录排序。`GET /api/projects/<id>/docs?path=<repo-relative-path>`
返回 `{ok:true,data:{path,body}}`，正文保留文件字节对应的 UTF-8 文本。只接受一个 path 参数，无写操作。
缺失目标返回 404，非法路径 400，不可读目标 422；错误使用 `{ok:false,error:{code,message}}`。
允许范围为登记 Repo 内 `README.md`、`AGENTS.md` 和 `docs/` 下 Markdown，禁止绝对路径、越界、符号链接目标或祖先。
边界是受信任本地 workspace，不承诺恶意 ancestor swap；无 native helper 或平台特定原子操作。
标准检查失败不阻止可读正文；非标准文档显示“未参与标准检查”。单篇失败仍显示文档导航和重试入口。

Docs 地址为 `#/projects/<id>/docs?path=<encoded-path>&section=<encoded-heading>`，省略 path 默认 README.md。
章节由 Markdown ATX 标题生成 Unicode slug，重复标题增加数字后缀；无章节时显示空目录。
回顾地址为 `#/projects/<id>/retrospectives/<id>`，filter_project/status/task query 保存精确筛选条件；
直达记录不符合筛选条件时仍单独显示并提示，失效目标显示错误。摘要由正文派生，不新增持久化字段。
Report 和回顾关联跳转使用受限内部 `from` 地址提供“返回来源页面”，Report 的原 Plan 返回继续可用。
地址保存选择、筛选和章节；滚动位置与展开状态仅在当前页面会话内存中保存，整页重载不保证恢复像素位置或源码模式。
读取时隔离过期响应，Refresh 重读文件，无实时推送；状态操作仍仅限已有 Backlog 更新。


## 工作修订、执行与验收

任务内容编辑通过共享 application API 提供 CLI/Web 入口，title/body 修改必带当前 revision，冲突不清除编辑草稿。
Plan show 额外返回内容计算得到的 revision；revision 不是新的持久化 Plan 生命周期。
`plan revise` 和 Web 的修订入口先返回 preview、confirmation token、变更字段及受影响任务 revision，确认后重查相同输入再写入。
已批准计划的确认记录成为本次修订的 approval note。物化后保留 Plan ID、任务 key 与 mapping；未开始任务的内容、优先级、
依赖可同步，独立编辑或已有执行历史的任务拒绝隐式覆盖。结构增删、key 改名、item_type/parent 改变明确拒绝并建议后续计划。
普通 I/O 失败尝试恢复本次受影响文件，失败给出诊断；不承诺跨进程事务或 crash consistency。

`execution/Attempt@1` 是独立 JSON authority。manifest 的 `artifact_layout.roots.executions` 声明该 type，
由同一项目 layout 解析 executions root。记录有稳定 attempt/execution ID、retry_of、项目与任务逻辑引用、输入任务快照和 revision、
关联 Plan 快照（存在物化来源时）、补充指示、起止时间、执行状态、结果、Git 快照、验证证据和验收结论。
状态为 running、stop_requested、unknown、succeeded、failed、stopped；执行结束与验收是不同事实，重试创建新尝试而不改写旧输入。

CLI 可记录外部工作；server 可接收受控 runner，默认无 runner；显式 `--pi` 启用服务端 Pi SDK，浏览器不能提供执行路径或任意启动命令。
header 模型选择器按 provider 分组展示本地 Pi 可用模型，并提供“使用 Pi 默认模型”；认证继续由本地 Pi 完成。
浏览器 localStorage 仅保存 provider/id 选择，刷新页面保留选择，“刷新”重读模型列表。无可用模型时提示本地认证，
失效选择保留并提示重新选择；已发现认证配置不代表远端额度或授权必然有效，调用失败仍按执行失败处理。
单项任务在启动请求时固定模型，显式重试使用当前选择；串行和并行 run 在创建时固定模型，后续派发、恢复和返工沿用。
默认选项在启动/创建时使用目标 Repo 的 Pi 设置解析成具体模型。切换不修改既有 attempt/run，默认 Pi 配置文件也不被网页改写。
attempt 的 `input.model` 保存启动模型，`progress.model` 保存 Pi session 实际模型；run 的可选 `model` 保存固定模型。
模型记录均仅含 provider/id；Web 不提供认证操作，也不返回凭据、API key、模型 endpoint 或原始配置。
同任务的重复启动返回已有活动尝试，unknown 阻止新工作；页面通过查询重读当前状态，断线不结束工作。
停止请求先记录 stop_requested，runner 确认结束后才成为 stopped；无法确认的结果为 unknown。
服务重启核对其管理的运行，缺少 handle 的活动记录为 unknown；外部工作记录不由服务恢复。
用户核实旧工作已停止并填写说明后可确认中断，再显式重试。runtime handles 仅在后端内存，不作为业务 authority。

验证记录包含命令、通过/失败、代码快照和保存在 executions root 的长期证据。验收时核对当前代码与验证快照，
并要求当前快照下各命令最新结果都通过、证据仍完整、任务输入未变且没有后继尝试；旧尝试不能越过正在进行的重试完成任务。
用户选择接受或继续修改，结论绑定具体尝试；接受才推进任务 done，普通状态更新不能绕过已有执行记录的验收。
验收不执行 merge/push，也不意味着后续 DAG 的 landed。Report 可用稳定逻辑引用记录证据，仍遵守原有交付资格。

当前仅支持本机单人、受信任 workspace 和 Node.js；执行快照需要 Git，可记录未提交和未跟踪改动。
静态写入 containment 和创建 no-clobber 适用于本轮新增执行文件；不抵抗恶意 ancestor swap，不依赖 native helper，
不承诺远端访问、多服务争抢、跨平台进程语义等价或自动恢复执行。凭据不得作为执行证据提交；Pi session 保存于 workspace runtime 目录。


Pi 任务按登记 Repo 执行，同项目已有其他 running/stop_requested/unknown 尝试时拒绝启动。进展是执行记录的可选 `progress` 字段，包含 session_id 与最近 200 条 at/type/text 事件，每条最多 8000 字符；完整历史由 Pi session 保存。
页面轮询只重读数据，保留输入、焦点与选区；追加指示携带当前 revision，冲突或投递失败明确显示。工作完成以 Pi 完整 prompt settle 和最终 assistant stopReason 为依据，模型错误或中止不显示成功。工具事件只显示工具名和开始/结束，不复制参数与输出。

验证结果提供“查看证据正文”。GET `/api/projects/<project>/executions/<attempt>/evidence?ref=<exact-ref>` 只接受该尝试的验证引用，核对静态 containment 与完整内容 SHA256 后返回最多 65,536 字符预览及 truncated 标记；缺失或篡改返回诊断，页面清除旧正文，不能以旧预览冒充当前有效证据。


## 串行计划运行

已批准、已物化的 Plan 可建立冻结执行快照并显式启动。调度按依赖、优先级和 ID 稳定选择一个 task，epic 不执行。上游的模型结束、验证通过与显式验收是不同状态；验收且成果基线一致后才派发下游。
失败暂停整个 run；暂停不会自动中止当前任务，停止当前会请求中止并暂停派发。刷新重读持久状态；服务重启后未知工作须先核对停止，不能自动重派。
旧 Plan 修订不会改写 run 快照，输入变更会暂停并显示原因；可确认旧工作停止后终止 run，再创建新范围，保留历史 attempt 的 retry_of。当前服务仅支持一个执行 owner。
Plan 页面以目标、进度、执行工作区和任务正文组织阅读，提供区块定位。串行与并行分别展示当前活动运行与控制，终态历史列表和详情默认折叠；选择历史时，活动运行入口及 failed/unknown 提醒仍保持可见。节点依赖与尝试链接、原始快照、运行控制和人工说明均保留；Report 必须通过运行证据资格，未确认不能宣称完成。


## 有限并行执行与交付

Repo 内最多两个节点并行，许可来自 Plan 的 `execution_policy.max_parallel=2` 和节点 `parallel/resources`，缺省串行。每次执行固定 Plan/任务快照、依赖、资源与验证命令。上游已接受但尚未落地不解锁下游；同资源节点互斥。

节点在各自 worktree 工作，宿主提交成果、验证和验收后，系统串行构造最新 integration head 上的合并候选。验证通过且 expected-ref 未变才推进专用 integration ref。冲突、检查失败和 ref 漂移均保留证据并暂停派发；未知工作需要人工核对。返工产生新尝试与 checkout，不覆盖已接受的历史。

并行范围完成表示所有节点已验证、验收、落地，实际 ref 与落地证据仍匹配。交付显示最终 ref/head，不自动修改用户 checkout、合并用户分支或 push。仅 Backlog 状态不能代替执行证据生成完成 Report。

串行 Plan 标为 done 是对已完成 run 的结案：后续 Repo 开发不撤销历史验收，结案校验保存的完成基线、当前任务输入和完整验收证据。它不表示当前代码重新通过了验证；Report 发布仍校验当前代码基线。

## 开发服务配置

项目登记可在 manifest 明文增加可选 `dev`，无配置项目仍正常可读。`host` 为 `127.0.0.1` 或 `::1`；
`endpoints` 以名称声明固定 `port`（1–65535），`processes` 以名称声明非空 `command` argv、Repo 相对 `cwd`
（根目录使用 `.`）及显式 `env`。名称为小写字母开头的小写字母、数字和下划线。端点与进程独立，
支持一个命令提供多个端点或多个进程分别提供端点。服务命令必须配置自身 strict-port 行为，不能自动递增。

配置解析自动提供 `HOST`、`<ENDPOINT>_PORT`、`<ENDPOINT>_ORIGIN` 环境变量（端点名转大写），
argv 和显式 env 可用 `${HOST}` 等占位符引用；保留变量不能覆盖，未知变量和 shell 风格 `$HOME` 拒绝。
不执行 shell 展开、不探测 npm scripts、不提供配置编辑器。

`pops dev ports` 列出本 manifest 端点并校验配置；`pops dev check <project>` 额外用 loopback bind 探测占用。
`project doctor` 纳入配置、Repo 内 cwd 的静态 realpath containment 和全 manifest 重复端口检查，不探测实时占用。
端口号即使配置不同 loopback host 也不能重复。check 能通过运行层提供的精确 owned endpoint 区分已管理端点与外部占用；
CLI 从实际 manager 的 running 配置快照获取 ownership；unknown 提供人工核实诊断。查询不启动服务、不写 manifest、不保留端口。
跨 Workspace Control 的未启动保留端口无法检测，真实服务登记前须核对工作区 authority。


开发服务以项目为启动/停止/重启最小单位。独立 workspace manager 持有 detached 进程组和运行配置快照，
不依赖 Pi 或 Workbench，CLI/终端退出后继续运行。所有端点 TCP 可达且所有进程存活后报告 running；
任一进程失败/自然退出清理本项目的兄弟与后代，其他项目继续。停止只发送信号给实际创建的进程组，
不会 kill 外部端口占用者；manager stop 才停止全部受管项目。启动和停止有界，失败保留诊断与有界近期输出。
manager 异常退出的遗留记录显示 unknown，不自动接管、恢复、重启或按旧 PID 清理；人工恢复契约见 AGENT_CONTRACT。

Workbench 项目 Overview 提供紧凑开发服务区：项目与进程状态、具名端点、查询/启动/重启/停止及展开诊断。
加载、未配置、manager 未运行、failed、unknown 和连接错误分别呈现；操作中禁止重复提交，查询失败保留已知状态。
unknown 不提供启动/重启，恢复使用 CLI 人工核实流程。项目切换废弃旧响应，轮询保留焦点和展开状态。
Workbench 仅为独立 manager 的客户端，不因页面关闭或自身重启停止项目；不提供网页 manager stop。
按当前固定 workspace 的 manifest endpoint 与实际监听端口匹配识别承载网页的项目，Web/API 禁止其 stop/restart
并指向 CLI；不承诺代理入口或未登记端点的自重启识别和自动重连。

## 跨项目任务依赖契约

当前跨项目任务依赖支持引用解析、Backlog CLI/application/HTTP 创建和 revision 保护的依赖集合编辑、Plan 混合引用写入/物化、共享就绪判断、正反向关系查询、受管运行与 Plan/Report 前置保护，以及 Web 依赖编辑和跨项目导航。

- Backlog 的 `depends_on: string[]` 使用当前联合语法：`PRO-058` 表示所属项目的任务，`mochi:MOC-001` 表示显式项目与任务。项目名遵循 manifest 的 project ID 规则，ID 遵循 Backlog 格式；不按 ID prefix 推断项目。解析后使用 `{project,item}` 身份，`project:item` 作为比较键；同项目裸 ID 与限定引用视为同一身份，混用重复项必须拒绝。
- Plan 保留 `plan/Plan@1` 与 `depends_on: string[]`。`prepare` 是该草案局部 key；`projectops:PRO-058`、`mochi:MOC-001` 是既有 task，引用本项目已有任务也必须限定项目。裸 Backlog ID 不是 Plan key。`parent` 仍仅为本 Plan epic 的局部 key，不支持跨项目父子关系。
- 引用解析的纯函数只校验语法。应用层从当前 workspace manifest 精确路由，校验项目、store prefix、对象 project/id 与 task 类型；未知项目、缺失/不可读对象、损坏数据均给出包含引用身份的诊断。引用不创建、复制或改写上游任务。
- 创建和依赖编辑校验自依赖、重复身份及从变更节点可达的任务依赖链；用完整身份检测跨项目环。可达对象不可读时拒绝写入，不要求扫描无关项目全部任务。修改以当前 revision 提交完整依赖集合，空集合表示移除全部；失败不改写目标。已有执行输入保护继续适用，引用编辑不绕过活动 run/attempt。
- Plan create/validate/approve/materialize/revise 校验局部图及既有引用；物化与修订写入前重新校验。上游不必 done 才能建立引用或物化。局部 key 经 mapping 转成本项目 ID，限定引用保留原值。mapping 仅包含本 Plan 新建项，外部任务不进入本 Plan 所有权、进度分母或 completed 范围。完整 mapping 的重复物化保持 no-op；不借重试覆盖数据。
- 物化后的 Backlog 依赖是执行事实。Plan 修订使用现有 preview/confirm、revision 与受控同步：独立编辑或已有执行历史不能隐式覆盖；Plan 草案不是第二个可独立改写的执行依赖 authority。
- 就绪判断检查直接前置的当前事实，不递归要求祖先全部 done。上游须为 done；todo/in_progress/blocked/cancelled 均不满足，重新打开后刷新必须重新阻塞。无受管 attempt 的任务以 done 为完成事实；有受管记录时必须具有对应当前输入与验证证据的有效接受，单独 succeeded 不满足；来自并行 run 的接受还必须 landed。取消不视为完成，读取失败不复用缓存解锁。已有本地串行验收与并行 landed 门禁继续保持。
- Plan 允许先创建和物化；run 创建要求 mapping 外的直接前置（包括同项目既有任务）已满足，否则拒绝创建，待上游完成后可重新创建。运行仅调度自身 mapping，不启动外部 Repo。冻结快照记录完整引用、上游输入/状态与接受或落地依据；每次派发和 Report 资格检查重新读取。冻结后输入变化或依据失效时阻塞/暂停并解释原因，不自动改写快照或扩大执行范围。本项目既有 completed-task reuse note 与证据规则继续适用。
- 正向关系列出直接前置及原因；反向关系只读扫描 manifest 已注册项目的 Backlog，使用完整身份匹配。局部损坏返回 diagnostics，并明确结果可能不完整。两种关系都是派生视图，不持久化第二份状态。

当前不提供 workspace Plan、多项目新任务物化、跨 Repo 调度、全局队列或 Capability/Release 对象。存储格式仍为当前字符串数组联合语法，不新增旧版转换或兼容分支，不需要重写现有自身或其他真实项目数据。受支持边界为受信任本地 Linux workspace、Node.js 22+、无新增 native helper；使用 manifest 路由、静态 containment 与既有 revision/no-clobber，不增加恶意 ancestor-swap 或跨项目事务保证。

Web 任务详情提供按项目筛选的 task 选择器，展示标题、项目、ID 与状态；添加、移除后以 revision 保存。冲突或引用失效时保留草稿，重读版本后由用户核对再提交。直接前置显示实时满足状态及原因，反向查询显示依赖当前任务的各项目任务；读取不完整时显式显示诊断。

Plan 修订的依赖选择器区分 Plan 内 key 与既有 project:ID，编辑进入同一 JSON 草案并沿用 preview/confirm。任务正文显示局部草案关系，物化任务另读取实际 Backlog 正反向关系。既有引用数量独立列出，不进入本 Plan 自有任务进度。任务链接进入真实所属项目，并将来源 Plan 或任务编码在路由中；刷新和浏览器历史导航保留来源返回入口。
