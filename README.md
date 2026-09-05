# ProjectOps

ProjectOps 是面向人类开发者和 Coding Agent 的本地 Project Operations 工具。它以可版本控制的
Markdown/JSON 文件为权威数据，计划统一管理项目注册表、Backlog、Plan、Delivery Report、项目文档体系和
Workflow Retrospective。

项目当前处于 Alpha 初始化阶段，以快速交付可运行的纵向工作流为主，不提供生产级安全、兼容性或完整边界保证。

当前真实 dogfooding 仅接入 ProjectOps 自身：新开发任务与计划由本产品管理，Workspace Control 既有条目
留在原系统，不导入或双写。schema 变化时仅对 dogfooding 产生且仍在使用的数据做一次性迁移，验证后删除
迁移脚本，不保留运行时兼容分支。已完成或归档数据不要求持续迁移；旧版本不可读时应明确提示版本不支持。
这是 Alpha 演进规则，具体操作与路由见 [AGENTS.md](AGENTS.md)。

Agent 使用前请阅读 [Agent 操作契约](docs/AGENT_CONTRACT.md)，其中集中说明 workspace 定位、CLI 返回值、
revision 冲突处理，以及 Plan 审批、交付和回顾的执行边界。

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
选择 project 后进入 Backlog，可按状态浏览全部条目；列表突出标题和选中态，详情顶部提供状态操作与刷新。
正文默认使用阅读排版，可切换 Markdown 源码；支持标题、段落、嵌套列表、表格、引用块、只读任务列表、分隔线、强调、代码和 HTTP(S) 链接，
其他语法保留为文本。原始 HTML 不执行，本地路径和非 HTTP(S) 链接只显示文本；revision 收入技术信息。
选择条目后可查看依赖，
并更新为 `todo`、`in_progress` 或 `done`。更新会刷新条目和项目摘要；revision 冲突时保留当前选择，
先点击 `Refresh item` 读取最新内容，再重新提交。未完成或缺失的依赖会显示提示；与 CLI 一样，
状态更新由用户显式决定，不自动推进依赖或强制改变状态。
Plans 提供标题、状态、目标和任务目录；长目标默认摘要，可展开全文。点击目录定位并展开对应任务，正文按项阅读；刷新保留展开状态，
审批与 materialization mapping 收入计划记录。执行进度单独显示 task 的完成比例、状态计数及映射条目的实时标题/状态；
epic 不计入完成率，缺失或损坏任务仍计入总数并显示诊断。未物化显示未开始执行，零 task 显示无可执行任务。
CLI 更新 Backlog 后点击 Refresh 可查看新进度。Plan 同时展示进行中、可开始和受阻任务，
排序与 `pops plan next` 一致，受阻项显示依赖 ID 和原因。点击任务进入 Backlog 详情，更新后点击“返回原 Plan”
会重新加载进度与推荐，并展开原计划；详情地址支持刷新和直接打开。
全部 task done 后，可在 Plan 详情点击“标为完成”，状态由 `approved` 变为 `done`（已完成）。
CLI 使用 `pops plan complete <project> <plan> --expected-revision <revision> --json`，revision 从 `plan show` 获取。
操作还会校验现有执行记录的验收与落地证据；done 计划保留历史，新增范围另建计划。
Plan 的交付报告区列出同项目关联报告，按生成时间降序排列，显示 outcome 与时间；点击报告可查看详情并返回原 Plan。
全部任务完成但没有报告时会单独提示；报告是创建时快照，当前进度变化不会改写已有报告。Reports 页面可展开完整详情，查看
交付 outcome、正文、验证、偏离与 workaround；技术记录折叠。关联 Plan、Backlog 和 Repo 文档可点击，并提供返回来源页面入口。
Docs 提供四份标准文档入口，并列出 `docs/` 下其他 Markdown。点击文档按需读取正文，支持章节目录、
相对 Markdown 链接与章节锚点；检查结果不阻止正文阅读。非标准文档标为未参与标准检查，缺失或不可读目标可重试。
Retrospectives 展示 workspace 完整列表，默认过滤当前项目；支持 status、project、task
精确过滤，project/task 留空表示全部，填写 `null` 表示 provenance 未记录。回顾按 inbox/active/archive 分组，
列表从正文派生摘要，详情优先展示渲染正文、下一步和结案说明，技术信息折叠；关联任务可点击。
Docs 与回顾详情支持直达地址；回顾筛选条件写入地址，刷新或任务往返后恢复。阅读位置与展开状态在当前页面会话内保留。
malformed artifact 单独显示诊断。Reports、Docs、Retrospectives 保持只读；Plans 可预览并确认修订，也可显式标为完成。点击顶部 Refresh 重读文件。Mermaid 暂按代码显示，图片不加载。

Overview 优先展示未完成计划和活动任务，分开显示计划状态、实时 task 进度与历史报告结果。
桌面两列、窄屏单列，条目标题完整换行；列表最多预览五条并显示对应范围数量，读取异常单独提示。
点击任务、计划、报告、回顾标题或四份标准文档入口可直达详情，链接支持复制、新标签页和刷新定位；
“返回 Overview”重读摘要并在当前页面会话内恢复滚动位置。回顾显示正文摘要，文档显示逐项可读性和标准检查问题。

开发者也可以增加 `--static-dir <path>` 覆盖静态资源目录。可选 `--host` 只接受
loopback 地址，`--port 0` 仅适合测试或一次性隔离运行。使用 `Ctrl-C` 或发送 `SIGTERM` 会关闭 listener。

本开发工作区也已接入统一启动器：

```bash
/home/ling/workspace/workspace-control/bin/workspace dev start projectops
```

此登记使用 `/home/ling/workspace` 中已初始化的 ProjectOps 数据，Web 与 API 共用
`http://127.0.0.1:12500`；启动时先构建，`Ctrl-C` 关闭本次启动的进程。
新初始化的 ProjectOps 项目列表为空，后续使用 `pops project add <子目录>` 显式登记，
不会自动导入 Workspace Control Catalog 中的项目或过程数据。

## 验证 Workbench

```bash
npm ci
npx playwright install chromium
npm test
npm run typecheck
npm run test:e2e
```

`npm run test:e2e` 先生成生产 build，再用 headless Chromium 运行浏览器 smoke：选择项目、浏览详情、
更新 Backlog、revision 冲突后刷新重试，以及领域阅读页的正常、空和 diagnostic 页面；还覆盖内容修订、执行控制及验收。
它也验证未知项目和 server 断连不会修改 authority 文件。每个测试自动创建并清理临时 workspace，
server 使用隔离端口，不需要运行真实开发服务。整套 E2E 上限 120 秒，单项 30 秒；失败 trace 保留在
已被 Git 忽略的 `test-results/`。浏览器版本由 Playwright 锁定，升级依赖后重新运行浏览器安装命令。
Linux 若提示系统库缺失，可按 [Playwright 浏览器安装说明](https://playwright.dev/docs/browsers) 安装所需依赖。

Workbench 仅供受信任本地用户和 workspace 使用，监听 loopback；workspace 只能由启动参数指定。
Web 支持 Backlog 状态/内容、Plan 修订、完成及执行控制/验收；mutation 要求 JSON、同源 browser Origin 和相应 revision。
它不提供用户账户、远程访问或对抗恶意本地并发的安全保证。

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
pops plan next my-app plan-release-workflow --json
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
- `pops init [dir] [--json]`：workspace 壳初始化（不登记 repo）；JSON 成功返回 `ok: true` 与
  `workspace: { name, manifest: ".pops/workspace.json" }`，失败返回 `ok: false` 与 `error` 并退出 1；
  JSON 模式仅写 stdout，省略选项时提供文本输出
- `pops project add/list/doctor`：显式登记、查询、拓扑校验
- `pops docs scaffold <project> [--json]`：为已登记 project 创建缺失的 README、AGENTS、产品规格和架构文档模板；已有普通文件只跳过，不覆盖
- `pops docs check <project> [--json]`：只读检查固定四份文档是否为普通文件并各自包含 Markdown 一级标题；失败时按固定顺序返回全部诊断
- `pops backlog init/add/list/show/update`：store bootstrap、CRUD、状态流转与 revision 保护
- `pops plan next <project> <plan-id> [--json]`：只读查询该 Plan 的可开始、进行中和受阻 task，解释依赖原因；
  可开始任务按 P0 → P3、ID 排序，next 为首项或 null。依赖可以位于同项目 Plan 外，查询不自动改状态或启动任务
- `pops plan create/list/show/validate/approve/materialize/revise/complete`：从 JSON 草案创建、列出、查看、校验、批准并将已批准的 `plan/Plan@1` artifact 写入 Backlog；Plan ID 由 title 稳定生成，
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
- 只有 approved Plan 才能 materialize；Plan 会保存每个局部 key 到 Backlog ID 的 `materialization.mapping`，重复执行完整 materialize（含 done Plan）返回 `no_op`
- backlog update 支持 `--expected-revision` 防止覆盖并发修改
- Report create 从 materialized Plan 和同一 project 的 Backlog 读取实际状态；未完成 task 必须提供非空 `--partial-acceptance`，Report 文件不会覆盖既有文件


## 工作基础能力

Backlog 详情提供“编辑任务内容”，修改标题和 Markdown 验收要求。冲突时保留草稿，显式重读最新版本后再提交。
Plan 修订采用草案 JSON 输入，先查看变更与受影响任务，再确认该次预览。已物化计划保留 keys 和 mapping；
只同步未开始且未独立编辑的任务。已开始、已完成或已有执行历史的任务受保护；物化后增删 key、改变类型或父级
需另建后续计划，界面和 CLI 会说明原因。

任务详情可查看执行尝试、冻结输入、改动快照、验证和验收结论。失败后重试保留原尝试。
验收要求执行成功、当前代码上的检查通过、证据完整且任务输入未变化；有执行历史的任务不能绕过验收直接标记 done。
没有执行记录的手工任务仍可按原工作流更新状态。

本版已接入 Pi 0.85.0。使用 `npm run workbench -- --workspace <workspace> --port <port> --pi` 启用本机 Pi；默认不配置 runner，启动/重试入口不可用；
可以通过 CLI 记录外部执行，在网页核对并验收。CLI 的 finish/verify 记录调用方提交的事实，不执行命令或替调用方验证真实性。
启用 Pi 后，header 右上角可按 provider 选择可用模型，或使用 Pi 默认模型；选择保存在当前浏览器。
认证在本地 Pi 内完成，Workbench 服务须使用相同用户和 Pi 配置目录，完成登录后点击网页“刷新”更新列表。
切换仅影响之后启动的单项任务（含显式重试）；串行和并行 Plan Run 在创建时固定模型，后续派发及重试继续使用该快照。
执行详情展示启动模型和实际模型；已保存的选择变得不可用时会提示重新选择，启动不会静默改用其他模型。
服务管理的工作独立于浏览器连接，页面重新进入后重读记录；服务重启后未确认的工作显示待核对，不自动重放。
外部 CLI 记录不归服务进程管理，不会因 Workbench 重启而被判定中断。

执行操作的完整参数和返回值见 [Agent 操作契约](docs/AGENT_CONTRACT.md#执行记录与验收)。
执行记录需要已登记的 Git Repo；普通项目登记、Backlog 和文档能力仍不要求 Git。


### Pi 单任务工作

启用 `--pi` 后，从任务详情填写指示并开始工作。页面自动刷新文本/工具进展，支持追加指示、请求停止、刷新重连和失败后重试。
追加指示在当前工具轮结束后生效；停止会清空 Pi 队列并等待中止确认。工作结束后查看 diff，再通过 execution verify 记录实际验证，显式接受或要求继续。

模型与凭据沿用本机 Pi settings/auth/environment，凭据留在服务端。加载当前 Repo 与祖先的 AGENTS.md、Pi 全局与项目 skills；禁用 extensions、prompt templates 和 themes，工具限定 read/bash/edit/write。
这不是操作系统 sandbox，适用于受信任本地 workspace。Pi session 保存在 workspace 的 `.pops/runtime/pi/<attempt-id>/`；执行记录保留 session ID 和最近 200 条进展，不复制完整会话。

首版不承载 Pi extension 的交互 UI；若 Pi 在最终回复中请求补充信息，填写补充指示后明确重试当前任务，保留前次尝试。


### 串行 Plan 执行

在 Plan 详情的“计划执行”区域冻结当前已批准、已物化的计划。创建只保存快照，点击启动后容量为一，按显式依赖和优先级推进。
当前任务成功后仍等待验证和显式验收；下游只有在上游已验收且成果仍在当前 Repo 基线中时开始。
暂停只停止后续派发，停止当前另发中止请求。失败暂停后填写核对说明再恢复；代码变化需提供检查后的当前 baseline digest。
修改计划不会改写旧 run；停止旧工作、确认 unknown 并终止旧 run 后，才以新版本重新创建。已完成任务复用需要指定 accepted attempt 与人工说明。

```bash
pops plan-run create projectops <plan-id> --expected-revision <plan-revision> --json
pops plan-run list projectops --json
pops plan-run show projectops <run-id> --json
pops plan-run pause projectops <run-id> --expected-revision <run-revision> --json
pops plan-run resume projectops <run-id> --note '已核对输入和代码基线' --expected-revision <run-revision> --json
pops plan-run close-stopped projectops <run-id> --note '旧工作已停止，终止本次范围' --expected-revision <run-revision> --json
```

CLI 保存控制意图，自动派发由启用 Pi 的 Workbench 服务负责；不要为同一数据 workspace 启动多个执行服务。


### Repo 内有限并行

Plan 显式声明 `execution_policy: {"max_parallel": 2}` 后，可在“并行计划执行”区域创建 run。节点只有声明 `parallel: true` 且 `resources` 不相交时才共同运行；缺省节点独占容量，依赖仅在上游落地后满足。
每次 run 从选定 commit 建立专用 integration ref，每个节点使用独立受管 worktree。Pi 完成修改后，由宿主在该节点 worktree 提交，记录实际验证并接受，再点击落地。落地在最新 integration head 上合并候选并验证，通过后才推进专用 ref；原始 checkout 与用户分支不自动更新，也不 push。

默认候选验证依次执行 `npm ci --ignore-scripts`、`npm test`、`npm run typecheck`、`npm run build`；依赖安装须有可用 registry。服务端可配置结构化命令数组；浏览器不能提交任意命令或 worktree 路径。
落地失败保留候选与证据，可重新核对后重试；需要修改已接受成果时，使用“重新工作”创建新尝试并重新验证验收，旧证据保留。暂停停止新派发，unknown 须先核对旧工作停止。

```bash
pops parallel-run create projectops <plan-id> --expected-revision <plan-revision> --json
pops parallel-run show projectops <run-id> --json
pops parallel-run pause projectops <run-id> --expected-revision <run-revision> --json
pops parallel-run resume projectops <run-id> --note '已核对失败原因' --expected-revision <run-revision> --json
```

最终交付提供 integration ref、head 与每次落地的证据；是否合并到用户目标分支由用户另行决定。
