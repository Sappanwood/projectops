# ProjectOps

ProjectOps 是面向人类开发者和 Coding Agent 的本地 Project Operations 工具。它以可版本控制的
Markdown/JSON 文件为权威数据，计划统一管理项目注册表、Backlog、Plan、Delivery Report、项目文档体系和
Workflow Retrospective。

项目当前处于 Alpha 初始化阶段，以快速交付可运行的纵向工作流为主，不提供生产级安全、兼容性或完整边界保证。

ProjectOps 自身的新开发任务与计划由本产品管理，其他真实项目按 Workspace 授权接入；自身 Repo 路由和开发服务也已切换到 ProjectOps。
Workspace Control 既有条目留在原系统作为历史，不导入或双写。schema 变化时仅对 dogfooding 产生且仍在使用的数据做一次性迁移，验证后删除
迁移脚本，不保留运行时兼容分支。已完成或归档数据不要求持续迁移；旧版本不可读时应明确提示版本不支持。
这是 Alpha 演进规则，具体操作与路由见 [AGENTS.md](AGENTS.md)。

Agent 使用前从 [ProjectOps 工作流 skill](skills/projectops-workflow/SKILL.md) 进入，按需读取
[Agent 操作契约](docs/AGENT_CONTRACT.md) 中的命令与数据说明。skill 负责步骤选择、证据判断和恢复路径。

`pops init <workspace>` 默认将自包含 skill 安装到该 workspace 的 `.agents/skills/projectops-workflow/`。
已有 workspace 在任一子目录执行 `pops skill install` 补装，`pops skill status --json` 查看内容标识和匹配情况，
`pops skill update` 更新未修改的受管文件。`init --skip-skill` 只初始化数据。
安装冲突或失败退出 1；若数据初始化已经完成，收据保留 `workspace.initialized: true`，用独立 skill 命令恢复。

本地修改、损坏记录与同名非受管内容默认保留。确认替换后，使用 status 返回的 `content_id` 执行
`pops skill update --replace --expected-content <content_id>`；只替换当前分发文件及安装记录，保留旧文件备份与无关文件。
完整命令、部分失败恢复和锁处理见 [Agent 操作契约](docs/AGENT_CONTRACT.md#workspace-skill-安装与恢复)。

受管 Pi 0.85.0 runner 显式加载当前 workspace 的安装 skill，覆盖同名全局/Repo 来源并去重；支持登记子 Repo 和更深目录。
其他外部 Agent 的自动发现未验证。workspace 安装不操作全局配置；全局安装仍需独立授权，
遵循 `~/.agents` 唯一活动源及各 Agent 配置目录的 symlink 约定。Repo 内 skill 和契约是唯一可编辑来源。

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
`npm pack` 先构建并将 `dist/`（含 skill bundle）打入本地安装包；安装包不需要源码 checkout。

Local Workbench server 通过显式 workspace 启动，默认只监听 `127.0.0.1:7331`：

```bash
npm run workbench -- --workspace "$HOME/my-workspace"
```

构建后 server 自动托管内置生产前端 Web 界面，浏览器访问 `http://127.0.0.1:7331` 即可体验。
项目栏按 ID 固定排序，一次点击切换项目；所有页面宽屏使用左侧导航，窄屏使用顶部两行导航。切换项目保留当前栏目并返回列表；窄屏导航可横向滚动，并自动露出当前项目。
进入 Backlog 后可按状态浏览全部条目；列表突出标题和选中态，详情顶部提供状态操作与刷新。
正文默认使用阅读排版，可切换 Markdown 源码；支持标题、段落、嵌套列表、表格、引用块、只读任务列表、分隔线、强调、代码和 HTTP(S) 链接，
其他语法保留为文本。原始 HTML 不执行，本地路径和非 HTTP(S) 链接只显示文本；revision 收入技术信息。
选择条目后可查看依赖，
并更新为 `todo`、`in_progress` 或 `done`。更新会刷新条目和项目摘要；revision 冲突时保留当前选择，
先点击 `Refresh item` 读取最新内容，再重新提交。未完成或缺失的依赖会显示提示；与 CLI 一样，
状态更新由用户显式决定，不自动推进依赖或强制改变状态。
Workbench 的 Workspace、Overview、Backlog、Plan、Reports、Docs、Research 和 Retrospectives 页面主体统一使用 React + TypeScript 与浅色文档布局。编辑、运行与服务控制继续复用原控制器。Plan 列表优先展示草案并收起空分组，单份详情默认“审阅计划”：完整目标、任务目录和默认展开的正文供连续阅读，宽屏右侧展示状态与审阅提示。顶部可修订计划，App 外 Agent 直接读取 Plan 文件；手动刷新查看外部修改并保留本地草稿、阅读位置和未变化正文的选区。执行控制、进度、报告与技术记录集中到“执行与结果” Tab，
审批记录在审阅页末尾折叠展示，materialization mapping 位于执行页。执行进度单独显示 task 的完成比例、状态计数及映射条目的实时标题/状态；
epic 不计入完成率，缺失或损坏任务仍计入总数并显示诊断。未物化显示未开始执行，零 task 显示无可执行任务。
CLI 更新 Backlog 后点击 Refresh 可查看新进度。Plan 同时展示进行中、可开始和受阻任务，
排序与 `pops plan next` 一致，受阻项显示依赖 ID 和原因。点击任务进入 Backlog 详情，更新后点击返回链接
会重新加载进度与推荐，并恢复原 Plan 的执行 Tab 与阅读位置；详情地址支持刷新和直接打开。
全部 task done 后，可在 Plan 详情的“执行与结果” Tab 点击“标为完成”，状态由 `approved` 变为 `done`（已完成）。
CLI 使用 `pops plan complete <project> <plan> --expected-revision <revision> --json`，revision 从 `plan show` 获取。
操作还会校验现有执行记录的验收与落地证据；done 计划保留历史，新增范围另建计划。
Plan 的交付报告区列出同项目关联报告，按生成时间降序排列，显示 outcome 与时间；点击报告可查看详情并返回原 Plan。
全部任务完成但没有报告时会单独提示；报告是创建时快照，当前进度变化不会改写已有报告。Reports 页面可展开完整详情，查看
交付 outcome、正文、验证、偏离与 workaround；技术记录折叠。关联 Plan、Backlog 和 Repo 文档可点击，并提供返回来源页面入口。
Docs 提供四份标准文档入口，并列出 `docs/` 下其他 Markdown。Research 提供 manifest Research root 下 Markdown 的只读列表与正文入口；两者复用章节目录、
相对 Markdown 链接与章节锚点；检查结果不阻止正文阅读。非标准文档标为未参与标准检查，缺失或不可读目标可重试。
Retrospectives 展示 workspace 完整列表，默认过滤当前项目；支持 status、project、task
精确过滤，project/task 留空表示全部，填写 `null` 表示 provenance 未记录。回顾按 inbox/active/archive 分组，
列表从正文派生摘要，详情优先展示渲染正文、下一步和结案说明，技术信息折叠；关联任务可点击。
Docs 与回顾详情支持直达地址；回顾筛选条件写入地址，刷新或任务往返后恢复。阅读位置与展开状态在当前页面会话内保留。
malformed artifact 单独显示诊断。Reports、Docs、Research、Retrospectives 保持只读；Plans 可预览并确认修订，也可显式标为完成。点击顶部 Refresh 重读文件。Mermaid fenced block 使用本地官方 runtime 的 strict 模式渲染，错误保留源码，图片不加载。

Overview 优先展示未完成计划和活动任务，分开显示计划状态、实时 task 进度与历史报告结果。
桌面两列、窄屏单列，条目标题完整换行；列表最多预览五条并显示对应范围数量，读取异常单独提示。
点击任务、计划、报告、回顾标题或四份标准文档入口可直达详情，链接支持复制、新标签页和刷新定位；
“返回 Overview”重读摘要并在当前页面会话内恢复滚动位置。回顾显示正文摘要，文档显示逐项可读性和标准检查问题。

开发者也可以增加 `--static-dir <path>` 覆盖静态资源目录。可选 `--host` 只接受
loopback 地址，`--port 0` 仅适合测试或一次性隔离运行。使用 `Ctrl-C` 或发送 `SIGTERM` 会关闭 listener。

本开发工作区通过 ProjectOps 自身管理服务：

```bash
cd /home/ling/workspace/projectops
npm run build
cd /home/ling/workspace
pops dev check projectops --json
pops dev start projectops --json
```

此登记使用 `/home/ling/workspace` 中已初始化的 ProjectOps 数据，Web 与 API 共用
`http://127.0.0.1:12500`；启动直接加载已验证的 `dist/workbench.js`，退出 CLI 不停止服务。
显式停止使用 `pops dev stop projectops`，重启使用 `pops dev restart projectops`；操作前核对活动执行。
新初始化的 ProjectOps 项目列表为空，后续使用 `pops project add <子目录>` 显式登记，
不会自动导入 Workspace Control Catalog 中的项目或过程数据。

## 开发质量检查

```bash
npm run quality       # lint、格式检查、TypeScript 检查；不构建、不写文件
npm run format        # 写入统一格式，提交前检查 diff
npm run quality:full  # quality、一次 build、Node 测试、Chromium E2E
```

[biome.json](biome.json) 是格式与基本静态规则的唯一配置，覆盖全部 `src/**/*.ts`、
`src/**/*.tsx`、`src/**/*.css`、`tests/**/*.ts`、`scripts/**/*.mjs`、根目录 JSON 和 `playwright.config.ts`。
生成物 `dist/`、依赖、测试输出及 npm 维护的 `package-lock.json` 不参与；Markdown 与 HTML 目前人工检查。
格式为两空格缩进、100 列换行；显式启用未使用 import/变量、不可达代码、非法赋值、debugger、
重复 case/参数等错误规则，不启用与现有 Alpha 开发无关的整套风格要求，也不设置 coverage 或行数门槛。
工具依据 [Biome 配置文档](https://biomejs.dev/reference/configuration/) 和
[CLI 文档](https://biomejs.dev/reference/cli/)，版本由开发依赖和 lockfile 固定。

低风险文案、样式和配置可实现后验证；Bug、数据或状态逻辑先用失败测试锁定行为；
CLI/API、权限、路径及并发契约变更使用 Red-Green-Refactor。具体必跑门禁见 [AGENTS.md](AGENTS.md#完工验收)。
格式修正与行为或结构重构分开提交，避免机械 diff 隐藏行为变化。
前端开发使用 [Workbench 前端规范](docs/FRONTEND_GUIDELINES.md)，其中的交付验收仅适用于实际受影响的前端页面与状态；Agent 操作项目数据仍从 [工作流 skill](skills/projectops-workflow/SKILL.md) 进入。

## 验证 Workbench

```bash
npm ci
npx playwright install chromium
npm run quality:full
```

`npm test` 和 `npm run test:e2e` 可独立运行，分别先构建再执行 Node 测试和浏览器测试。
已有当前 build 时可用 `npm run test:unit` 或 `npm run test:browser`；这两个底层入口不构建，
不应用旧 build 验证新源码。`quality:full` 复用它们以避免重复构建。浏览器测试用 headless Chromium 运行 smoke：选择项目、浏览详情、
更新 Backlog、revision 冲突后刷新重试，以及领域阅读页的正常、空和 diagnostic 页面；还覆盖内容修订、执行控制及验收。
它也验证未知项目和 server 断连不会修改 authority 文件。每个测试自动创建并清理临时 workspace，
server 使用隔离端口，不需要运行真实开发服务。整套 E2E 上限 240 秒，单项 30 秒；失败 trace 保留在
已被 Git 忽略的 `test-results/`。浏览器版本由 Playwright 锁定，升级依赖后重新运行浏览器安装命令。
Linux 若提示系统库缺失，可按 [Playwright 浏览器安装说明](https://playwright.dev/docs/browsers) 安装所需依赖。

Workbench 仅供受信任本地用户和 workspace 使用，监听 loopback；workspace 只能由启动参数指定。
Web 支持 Backlog 状态/内容、Plan 修订、完成及执行控制/验收；mutation 要求 JSON、同源 browser Origin 和相应 revision。
它不提供用户账户、远程访问或对抗恶意本地并发的安全保证。

### 测试环境诊断

纯 domain/文件测试与需要 Git 子进程、HTTP listener、Chromium 或本地 Pi 配置的测试有不同环境需求。
环境启动失败不能作为业务断言的 TDD Red；先保留原命令、完整错误和 fixture 范围，再按以下顺序定位。

- Node runner 只报告文件级 `test failed` 时，可用 `node --import tsx tests/<实际文件>.test.ts`
  直接执行已定位的测试文件获取断言；built CLI 用例仍须先构建当前源码。
- 子进程同时检查 `error`（含 `code/syscall`）、`status`、`signal`、`stdout` 和 `stderr`。
  即使 status 为 0，空 JSON 收据也不能当作成功或有效业务 Red；先确认命令实际运行并产生预期输出。
- `START_FAILED`、`fetch failed` 或 `UND_ERR_SOCKET` 先核对 server 输出、监听是否成功及是否提前退出。
  `listen/spawn EPERM` 须保留底层错误；不能仅凭连接错误推断 sandbox 限制。
- 检查 `NODE_USE_ENV_PROXY` 及 `NO_PROXY/no_proxy` 是否包含 loopback。确认本地请求被代理后，
  可在单次测试命令中保留已有例外并追加 `127.0.0.1,localhost`；不要输出包含凭据的代理 URL。
  若两者原为空，命令示例为 `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost npm run test:unit`。
- 真实 Pi 设置读取可能需要配置锁；读取失败不能直接解释为未认证，也不能把缺省配置当作真实设置验证成功。
  本地只读 smoke 只输出必要的模型摘要，执行状态诊断只投影活动尝试等必要字段，不打印完整 diff 或凭据。

确认权限限制后，通过当前审批机制运行精确测试命令，沿用仍适用的已有授权；fixture 保持临时 workspace、
隔离 Repo 和 ephemeral ports。Playwright 优先直接运行，避免增加无必要的 subprocess 包装。
execution fixture 保持同一 workspace 一个服务 owner，涉及 finish/retry 时初始化 Git。
诊断后回到该变更要求的标准门禁；仅在新改动、失败或未解决疑点存在时重跑。

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

# 5. 为 project 初始化 backlog store（自动分配 workspace 内未占用代号）
pops backlog init my-app
# 如需固定代号，在首次初始化时改用：pops backlog init my-app --id-prefix MYA

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
- `pops backlog init <project> [--id-prefix <PREFIX>] [--json]`：初始化并分配当前 manifest 登记 store 内未占用代号；自定义只接受非空 ASCII 大写字母和数字，原样验证。自动候选为 project ID 去连字符、取前三位并转大写，冲突后依次附加 `2`、`3`……（如 `MOC` → `MOC2`）。冲突、不可读/无效 store 和已有目标均明确拒绝；参数、收据和正常并发锁恢复见 [Agent 操作契约](docs/AGENT_CONTRACT.md#backlog初始化与代号)
- `pops backlog add/list/show/update`：CRUD、状态流转与 revision 保护
- `pops plan next <project> <plan-id> [--json]`：只读查询该 Plan 的可开始、进行中和受阻 task，解释依赖原因；
  可开始任务按 P0 → P3、ID 排序，next 为首项或 null。依赖可以位于 Plan 外或其他已登记项目，查询实时核对完成/接受/落地依据，不自动改状态或启动任务
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
- 只有 approved Plan 才能 materialize；Plan 会保存每个局部 key 到完整任务身份的 `materialization.mapping`（owner 使用裸 ID，其他项目使用 `project:ID`），重复执行完整 materialize（含 done Plan）返回 `no_op`
- backlog update 支持 `--expected-revision` 防止覆盖并发修改
- Report create 从 完整 materialized Plan 和各映射项目的 Backlog 读取实际状态；未完成 task 必须提供非空 `--partial-acceptance`，Report 文件不会覆盖既有文件


## 工作基础能力

Backlog 详情提供“编辑任务内容”，修改标题和 Markdown 验收要求。冲突时保留草稿，显式重读最新版本后再提交。
Plan 修订采用草案 JSON 输入，先查看变更与受影响任务，再确认该次预览。已物化计划保留 keys 和 mapping；
只同步未开始且未独立编辑的任务。已开始、已完成或已有执行历史的任务受保护；物化后增删 key、改变类型或父级
需另建后续计划，界面和 CLI 会说明原因。物化后的目标项目也不可迁移。

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

执行收据可能包含完整代码快照，超过工具输出预算时会被截断。将完整 JSON 保存到本次任务的私有临时文件，检查命令退出码和 JSON 成功字段后，仅提取 `data.attempt.id`、`data.attempt.revision` 等所需字段。若写操作的返回已被截断，先用 `execution show` 以同样方式核对持久化状态，不因解析失败重复提交 `finish`、`verify` 或 `accept`。收据文件可能含代码和执行上下文，不提交到 Git；后续写入使用读回的最新 revision。


### Pi 单任务工作

启用 `--pi` 后，从任务详情填写指示并开始工作。页面自动刷新文本/工具进展，支持追加指示、请求停止、刷新重连和失败后重试。
追加指示在当前工具轮结束后生效；停止会清空 Pi 队列并等待中止确认。受管 Pi 用 bash 首行 `# projectops-verify` 标记真实检查，runner 自动保存实际工具结果及当时代码快照。工作结束后查看 diff 与验证证据，缺失或失效时补充 execution verify，再显式接受或要求继续；最终摘要不替代证据。

模型与凭据沿用本机 Pi settings/auth/environment，凭据留在服务端。加载当前 Repo 与祖先的 AGENTS.md、Pi 全局与项目 skills；禁用 extensions、prompt templates 和 themes，工具限定 read/bash/edit/write。
这不是操作系统 sandbox，适用于受信任本地 workspace。Pi session 保存在 workspace 的 `.pops/runtime/pi/<attempt-id>/`；执行记录保留 session ID 和最近 200 条进展，不复制完整会话。

首版不承载 Pi extension 的交互 UI；若 Pi 在最终回复中请求补充信息，填写补充指示后明确重试当前任务，保留前次尝试。


### 串行 Plan 执行

在 Plan 详情“执行与结果” Tab 的“串行执行”区域冻结当前已批准、已物化的计划。创建只保存快照，点击启动后容量为一，按显式依赖和优先级推进。
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

### 开发服务配置与预检

ProjectOps 可读取项目登记的可选 `dev` 配置并检查固定端口；配置/查询不需要 Workbench 或 Pi。
在隔离 workspace 的 manifest 项目登记中加入以下 descriptor（示例端口不代表工作区已分配）：

```json
{
  "path": "my-app",
  "dev": {
    "host": "127.0.0.1",
    "endpoints": { "web": { "port": 12345 } },
    "processes": {
      "web": {
        "command": ["npm", "run", "dev", "--", "--host", "${HOST}", "--port", "${WEB_PORT}", "--strictPort"],
        "cwd": ".",
        "env": {}
      }
    }
  }
}
```

```bash
pops dev ports --json
pops dev check my-app --json
pops project doctor --json
```

command 使用 argv；变量只替换 HOST 与端点 PORT/ORIGIN，自动注入对应 env。命令须支持并启用自身 strict-port；
不通过 shell 执行。cwd 必须静态解析到 Repo 内。doctor 检查全 manifest 重复分配，check 额外探测端口占用。
查询不会启动项目。已切换的项目使用 ProjectOps manifest，其余 Workspace Control 服务保持原 authority；
登记真实端口前须同时核对两套系统的工作区保留分配。


### 独立开发服务管理

```bash
pops dev start my-app --json
pops dev status my-app --json
pops dev restart my-app --json
pops dev stop my-app --json
pops dev manager stop --json
```

首次显式 start（或已停止项目的 restart）按需启动独立 Node manager；不需要 Pi、Workbench 或 Workspace Control。
CLI 返回后项目继续运行，关闭终端或重启 Workbench 不影响它。项目端点在 8 秒内全部 TCP 可达且进程仍存活才返回 running；
这表示端点可打开，不保证业务健康。stop 只停止该项目；manager stop 停止该 workspace 的全部受管项目并退出 manager。
没有开机自启。只支持受信任本地 Linux workspace；命令必须使用自身 strict-port 行为。

status 的 failed/unknown 包含诊断及每个进程最多 4096 字符的近期输出。manager 异常失联时不按遗留 PID 接管或 kill，
status/stop/restart 返回 unknown；人工恢复步骤见 [Agent 契约](docs/AGENT_CONTRACT.md#独立开发服务生命周期)。
IPC 路径过长、权限问题或版本不兼容会明确报错，不自动改用 TCP 或中断已有服务。

项目 Overview 的“开发服务”区提供查询、启动、重启、停止及具名“打开成果”链接，并列出各进程状态和可展开诊断。
网页与 CLI 共享独立 manager；浏览或轮询不启动 manager，首次点击启动才按需启动。关闭网页或重启 Workbench
不会停止其他开发项目。未配置项目通过 manifest/CLI 配置流程登记；unknown 禁止盲重启，连接错误先查询状态。
如果当前 workspace 的项目 endpoint 端口与实际 Workbench 监听端口一致，网页与 API 禁止停止/重启该项目，
请改用 `pops dev stop <project>` 或 `pops dev restart <project>`。首版没有网页 manager stop、配置编辑器或实时终端。


### 自身开发服务与恢复

本工作区的 ProjectOps 数据 workspace 是 `/home/ling/workspace`，服务配置为其 `.pops/workspace.json` 中的
`projects.projectops.dev`。正常入口为 `pops dev start/status/stop/restart projectops`；12500 不再由 Workspace Control 启动。
启动前在 Repo 构建并验证，服务使用当前 `dist/`，不隐式执行 build。停止或重启前核对所有已登记项目的
受管 running/stop_requested/unknown execution 和未结束 Plan run；未确认停止的工作不能直接中断。

PRO-072 切换保留的已验证构建位于数据 workspace 的 `.pops/runtime/cutover-PRO-072/recovery-build/`，
原配置、迁移基线和校验清单位于同级切换目录。该构建包含独立 `dist/`、package manifest 和 lockfile，
复用 Repo 的 `node_modules`，用于源码或 build 回归时恢复；它不覆盖依赖损坏或不兼容的数据 schema 变更。
升级依赖或 schema 前仍须按实际变更保存相应恢复材料。

即使当前源码不能构建，也可从终端查询和停止自身服务：

```bash
cd /home/ling/workspace
node .pops/runtime/cutover-PRO-072/recovery-build/dist/cli.js dev status projectops --json
node .pops/runtime/cutover-PRO-072/recovery-build/dist/cli.js dev stop projectops --json
```

确认旧服务及其进程组已停止、12500 已释放后，在同一终端前台启动保存的构建：

```bash
node .pops/runtime/cutover-PRO-072/recovery-build/dist/workbench.js --workspace /home/ling/workspace --port 12500 --pi
```

此时唯一 Workbench 进程由终端持有，manager 对该项目显示 stopped；不要同时执行 dev start。
修复并验证 Repo 构建后，先以 `Ctrl-C` 结束前台恢复服务，再执行 `pops dev check projectops` 和
`pops dev start projectops` 回到受管运行。manager 自身异常失联或版本不兼容时，按
[Agent 契约](docs/AGENT_CONTRACT.md#独立开发服务生命周期) 核对 ownership，不能凭遗留 PID kill 或清理锁。

### Plan 跨项目物化

一份 Plan 可在同一 workspace 向多个已登记且 Backlog 已初始化的项目创建任务。item 的 `project` 默认 Plan owner；局部依赖可跨项目，parent 只能同目标项目。mapping 保存 owner 裸 ID 或 `project:ID`，只统计该 Plan 新建项；物化后不能迁移目标。

物化失败先核对 receipt、Plan 和各目标 Backlog；修复诊断后重试会复用已确认项并补齐，完整重试为 no-op。`state: partial` 期间不能修订、完成、发布 Report 或启动 run。跨项目映射完整后，在各任务实际项目执行和接受单任务 execution，再由 Plan owner 汇总 Report 和 complete；两类自动 run 均拒绝跨 owner mapping。Workbench 提供真实项目链接、返回 owner Plan 和 CLI 恢复提示。

参数和恢复步骤见 [Agent 操作契约](docs/AGENT_CONTRACT.md#向多个项目创建任务)。

### 跨项目任务与 Plan 依赖

Backlog 创建的 `--depends-on` 支持 `project:ID`；`backlog update --depends-on <完整集合>`
配合 `--expected-revision` 替换依赖，空字符串清空。引用仅连接当前 workspace 内已登记项目的 task，
不会创建或改写外部任务。CLI、typed application API 与 HTTP POST/PATCH 共用校验，拒绝重复、自依赖、
可达循环及不可读目标。实际参数和 JSON 示例见 [Backlog 操作契约](docs/AGENT_CONTRACT.md#backlog创建与推进)。

`plan next` 与 Workbench projection 实时解析跨项目直接前置；依赖详情 API 同时返回“依赖谁／谁依赖我”与不完整诊断。
串行和并行 run 冻结外部完成依据，每次派发与完成前重验，仍只调度本项目任务。Plan 可先物化，
run 创建须等待前置满足；依据变化后按显式暂停/恢复或终止后重建处理。Plan/Report 的交付范围只计该 Plan mapping 中的新建项，包括跨项目项；既有前置不计入。

Plan 草案的 `depends_on` 可同时包含局部 key 和既有任务限定引用，例如
`["client", "mochi:MOC-001", "ccp:CCP-001"]`。先在各项目创建 task，再在产品项目创建、校验、批准和物化 Plan；
CLI 完整草案与步骤见 [混合依赖示例](docs/AGENT_CONTRACT.md#混合依赖草案示例)。两项消费任务可引用同一设施 task，设施成果只有一份状态。

Web 从 `/#/projects/<project>/backlog/<item>` 的“编辑依赖”选择项目/task 并保存；
从 `/#/projects/<project>/plans/<plan>` 的“修订计划”选择 Plan 内或既有依赖，再预览和确认。
“审阅计划”的依赖图按「前置 → 后续」展示计划声明，节点仅显示任务代号，悬停或聚焦查看标题，点击进入 Backlog；尚未生成条目的节点定位到计划正文。跨项目任务保留项目限定和返回入口，既有任务使用虚线框，宽图可局部滚动。
任务详情显示直接前置、满足原因与反向影响，Plan 只统计自己的 mapping；点击外部任务后可返回来源，刷新后继续保留入口。
上游满足后使用 Refresh 重查 ready，只有 succeeded 的 attempt 不足以解锁，有执行记录时还需要有效接受和适用的 landed 证据。
