# ProjectOps Agent 操作契约

本契约描述当前 Alpha CLI 的操作顺序与结果处理。开始任务先读 [AGENTS.md](../AGENTS.md)，
产品数据约束见 [PRODUCT_SPEC.md](PRODUCT_SPEC.md)，人工演示见 [README.md](../README.md)。
CLI 参数、输出或生命周期改变时，同步更新本文并在隔离 workspace 验证相关示例。
工具操作顺序与恢复决策从 [工作流 skill](../skills/projectops-workflow/SKILL.md) 进入；开发代码的质量入口见 [README](../README.md#开发质量检查)，前端交付使用 [前端规范](FRONTEND_GUIDELINES.md#前端交付验收)。本文不重复维护开发规范。

## 选择 workspace 与入口

使用安装后的 `pops` CLI，在目标数据 workspace 或其子目录执行。开发者也可以在 Repo 构建后以
`node <ProjectOps Repo>/dist/cli.js` 调用同一入口；自身 dogfooding 的位置按 Repo AGENTS.md 选择。

```bash
pops --help
pops project list --json
pops project doctor --json
```

`.pops/workspace.json` 是数据路由 authority；project 路径与 typed artifact roots 由 CLI 解析。
缺失或无效 descriptor 时停止相关操作，不回退 Workspace Control roots，不自行拼接输出目录。
只在用户授权且确实缺失时运行 `pops init <workspace>`、`pops project add <repo-relative-path>` 或
`pops backlog init <project>`，然后重新 list/doctor。Workspace Control 既有条目留在原系统，不导入、迁移或双写。

## 调用与结果处理

Agent 优先传 `--json`，同时检查退出码、stdout 和 stderr。`init --json` 在数据初始化完成后返回
`{ "ok": true, "workspace": { "name": "...", "manifest": ".pops/workspace.json", "initialized": true }, "skill": { "status": "installed", "...": "..." } }`。
跳过安装时 `skill.status` 为 `skipped`。skill 冲突或失败时 `ok:false`、退出 1，仍保留 workspace 对象与
`initialized:true`；原有数据可用，应改用 skill 独立入口恢复。数据初始化本身失败返回
`{ "ok": false, "error": "..." }` 并退出 1。JSON 模式只写 stdout；文本模式说明数据与 skill 各自状态，失败诊断写 stderr。
当前输出没有统一 envelope，不能一律读取
`data` 或要求 `ok` 字段。代表性成功结果如下：

| 命令 | 读取位置 |
|---|---|
| `init` | `workspace.name`、`workspace.manifest`、`workspace.initialized`、`skill.status` |
| `skill install/update/status` | `ok`、`skill`；前置路由/参数/读取失败为 `ok:false,error` |
| `project list` | `projects` |
| `backlog add` | `item.id`、`item.revision` |
| `backlog show` | 顶层 `id`、`status`、`revision`、`body` |
| `backlog update` | `no_op`、`changed_fields`、`revision`、`before`、`result` |
| `plan create` / `plan approve` | `plan` |
| `plan show` | 顶层 Plan |
| `plan next` | `ready`、`in_progress`、`blocked`、`next`、`diagnostics` |
| `plan materialize` | `mapping`、`no_op` |
| `report create` / `report show` | 前者 `report`，后者顶层 Report |
| Retrospective capture/triage/archive / show | 前者 `retrospective`，后者顶层记录及 `revision` |

非零退出时停止依赖此结果的写操作；即使指定 `--json`，部分错误仍只写 stderr，不对空 stdout 强行
JSON.parse。Report/Retrospective 的部分失败返回 `{ "ok": false, "error": "..." }`，不能推断所有错误均如此。
读取结果有 diagnostics 时应查看并报告，不能将损坏数据视为空列表。
创建操作返回不明确时先 list/show 确认，避免盲重试产生重复条目；已有目标冲突不通过删除文件绕过。
多行正文优先 `--body-file`，调用工具优先参数数组，不把正文直接插入 shell 代码。

## Workspace skill 安装与恢复

- `pops init [dir] [--skip-skill] [--json]` 默认安装，已有 manifest 仍拒绝重新 init；未知选项与多余目录参数失败且不写入。
- `pops skill install [--json]` 从当前 cwd 向上解析 manifest，只为该 workspace 补装；完整匹配的重复安装不写入。
- `pops skill status [--json]` 只读查询：`status` 为 `missing/current/outdated/conflict`，有效查询退出 0；必须继续检查 `matches_cli`。
- `pops skill update [--json]` 显式授权更新完整且未改动的受管文件，也可补装缺失安装；不会默认覆盖本地改动。
- `pops skill update --replace --expected-content <content_id> [--json]` 显式授权替换已核对快照中的当前分发文件与安装记录。
  token 来自最新 status；stale token 拒绝。无关文件、其他 skills 和旧版不再分发的文件均保留。

`skill` 收据包含相对 `target`、当前 CLI 的 `distribution_id`、安装记录的 `installed_id`、现场快照 `content_id`、
`matches_cli` 与 `problems`。mutation 补充 `no_op`、`changed` 和 `backups`；成功状态为 `installed/updated/current`，
冲突为 `conflict`，I/O 或并发失败为 `failed`。后两者 `ok:false`、退出 1，并给出 `recovery`。
安装文件集按 SHA256 标识，不仅比较 package version；同 package version 下契约/skill 的任何分发内容变化都会产生新 ID。

安装目标固定 `.agents/skills/projectops-workflow/`，`.projectops-install.json` 记录来源和逐文件摘要。
更新先把旧文件移入目标内唯一 `.projectops-backup-*/<原相对路径>`，再以 no-clobber 创建新文件；备份不自动删除。
若正常并发创建/修改介入，拒绝覆盖并保留新旧内容。部分失败可能已更换部分文件，收据的 changed/backups 是实际动作，
不是跨文件事务。先 status 并检查文件/备份：未改动旧安装可直接 update；部分写入、缺失或损坏安装需确认后以最新 token replace。
若最终记录尚未写入，现场会被视为非受管内容并保护，不能靠反复 init 或递归删除恢复。

安装器使用 `.agents/skills/.projectops-workflow.lock` 空目录排他；失败正常释放。进程中断可能留下锁，
必须先确认没有安装器运行，再只移除该空锁目录并重新 status。所有安装祖先和分发目标拒绝 symlink/非普通对象；
路径诊断须由用户修正后重试，不沿 `.agents` 或 skills symlink 写入外部位置。支持边界为受信任本地 Linux workspace、
Node.js 22+、无 native helper；不承诺恶意 ancestor swap、跨文件事务、崩溃自动恢复或 Windows/macOS 等价保证。

构建从 Repo skill、references 和本契约操作章节生成自包含 bundle；安装副本引用自己的 `references/AGENT_CONTRACT.md`，
不依赖开发机路径或源码。修改应回到 Repo 来源并重新构建/更新；不要在安装副本维护第二份契约。
受管 Pi 0.85.0 runner 用真实 ResourceLoader 显式接入当前 workspace skill，按名称去重并优先该来源，进展显示实际 filePath。
已安装但过期/损坏/本地修改时拒绝启动并提示恢复；未安装时沿用 Pi 原有 skill 发现。
已通过登记 Git 子 Repo、深层目录和 workspace 根目录的实际资源加载与 read/bash 只读操作验证，无付费模型请求。
其他外部 Agent 自动发现未验证，不保证全平台通用发现；全局安装不属于这些命令的写入范围。

## Backlog：初始化与代号

```bash
pops backlog init mochi --json
pops backlog init mochi-write --id-prefix MWT --json
```

`pops backlog init <project> [--id-prefix <PREFIX>] [--json]` 只用于已登记、尚未初始化的 store。
`--id-prefix` 必须为非空 ASCII 大写字母或数字组合（`A-Z`、`0-9`）；无额外长度限制，
不转换大小写、不去空白、不删除字符。小写、空值、空白、连字符及其他字符明确拒绝，不替换用户输入。

省略参数时，先将 project ID 去连字符、取前三位并转大写作为 base；依次尝试 `base`、`base2`、
`base3`……，采用第一个未占用候选。例如先初始化 mochi 得到 `MOC`，再初始化 mochi-write 得到 `MOC2`；
若 `MOC3` 也已占用，后续同 base 项目会跳至 `MOC4`。自动代号取决于初始化时的占用情况，不预留未初始化项目的代号。
指定 `MWT` 成功后，后续 add 使用 `MWT-001` 等编号，仍从 add 收据读取真实 ID。

查重仅覆盖当前 `.pops/workspace.json` 登记项目、按 manifest layout 解析的 Backlog roots；
不扫描未登记目录、其他 workspace 或 Workspace Control。只有可读取目录中三个初始化目标
`backlog.json`、`items/`、`INDEX.md` 均不存在时才视为未初始化。缺失/不可读 root、部分 store、
非法 manifest 或 project_id 不匹配会阻止创建，诊断指出项目、位置与原因；先检查权限并修复/恢复对应 store，
不要删除数据绕过检查。自定义冲突报告占用项目，选用其他合法代号后再试。上述拒绝不会创建目标 store 文件。

成功 JSON 沿用 `{ok:true,store:{project_id,id_prefix,root}}`，`id_prefix` 是实际保存值，`root` 为 workspace 相对路径；
文本输出也显示代号。失败退出 1，错误写 stderr，JSON 模式不保证失败 envelope。未知选项、缺值、重复代号选项和多余参数均拒绝。
已有 store（即使为空）重复 init 仍失败且保持原数据；此参数不是改名入口，不自动重编号、迁移或修复历史重复代号。

同 workspace 的 backlog init 使用 `.pops/runtime/backlog-init.lock` 空目录排他，覆盖查重、分配和 no-clobber 创建。
锁占用时失败，等待当前初始化结束后重试；中断遗留锁须先确认没有初始化进程运行，再仅移除该空锁目录。
正常返回（成功或失败）释放自己取得的锁。初始化期间不要并发手改 manifest/store；锁不协调项目注册或手工修改。
支持受信任本地 Linux workspace、Node.js，无 native helper；不承诺恶意 ancestor swap、跨文件事务或崩溃自动恢复。

## Backlog：创建与推进

先列出现有任务，确认范围和依赖；正文写清目标、验收和不在范围。`task.md` 是调用方准备的正文输入文件。

```bash
pops backlog list projectops --json
pops backlog add projectops -T "任务标题" -c docs --priority P1 --body-file task.md --json
```

从创建结果的 `item.id` 取得 ID；下例的 `item_id`、`revision` 必须来自实际结果，不猜编号。

```bash
pops backlog show projectops "$item_id" --json
pops backlog update projectops "$item_id" --status in_progress --expected-revision "$revision" --json
```

`show` 的顶层 `revision` 用于下一次写入。完成实际工作并验证后，重新 show，使用最新 revision 将状态更新
为 `done`。发生冲突时读取最新内容、判断原意是否仍成立，再决定是否提交；不得去掉 revision 强制重试。
CLI 的 revision 参数可选，Agent 写入必须携带。状态支持 `todo|in_progress|done`；update 也支持单独的标题/正文编辑，不能与状态混合提交。已有执行记录的任务必须通过 execution accept 完成，不能直接 update done。
更新后的状态从 `result.status` 读取，更新前状态从 `before.status` 读取；成功收据没有 `after` 字段。
创建可用 `--item-type task|epic`、`--parent-id <ID>`、`--depends-on <ID1,ID2>`。
依赖不会自动执行，也不会强制阻止状态变更；Agent 根据验收与依赖实际情况推进，不能仅为生成 Report 标记完成。

## Plan：草案、批准与 materialize

多项有依赖的工作可先准备 `plan-draft.json`；单项任务不必制造 Plan。以下是隔离验证可用的最小草案：

```json
{
  "title": "Agent workflow",
  "goal": "验证计划到交付的流程",
  "items": [{
    "key": "prepare",
    "title": "准备交付",
    "item_type": "task",
    "priority": "P1",
    "body": "完成约定工作并提供验证证据。"
  }]
}
```

```bash
pops plan create projectops --input plan-draft.json --json
pops plan list projectops --json
pops plan show projectops "$plan_id" --json
pops plan validate projectops "$plan_id" --json
```

`plan_id` 取创建结果的 `plan.id`；示例标题生成 `plan-agent-workflow`。草案里的 `parent`、`depends_on`
引用同份草案的局部 key，不是既有 Backlog ID。create 拒绝同 ID 覆盖。修订使用下文 plan revise 的 preview/confirm 流程，不重新 materialize 制造重复任务。

approve 是记录审批的写操作。Agent 先完成草案和校验，再依据用户对该具体范围的批准或既有明确授权执行；
已有授权不重复询问。校验成功不等于用户批准，review note 如实记录依据，不伪造审批或审查结果。

```bash
pops plan approve projectops "$plan_id" --review-note "$approval_note" --json
pops plan materialize projectops "$plan_id" --json
pops plan show projectops "$plan_id" --json
```

approve 要求非空 note，仅支持 draft → approved，再次批准会报错。materialize 只接受 approved Plan，
按父子关系与依赖顺序创建条目，返回 key → Backlog ID 的 `mapping`；Plan 保存 `materialization.mapping`。
后续从 mapping 读取任务 ID，不预测编号。完整 materialize 的重复执行返回 `no_op: true`。
失败后先 show Plan 和 list Backlog 核对现状；Alpha 不承诺跨进程事务或崩溃恢复。

## Plan：查询下一步任务

```bash
pops plan next projectops "$plan_id" --json
pops plan next projectops "$plan_id"
```

成功返回 `{ok:true,plan_id,ready,in_progress,blocked,next,diagnostics}`；任务含 id/title/priority/status，
blocked 额外含 reasons（依赖 id/code/message）。ready 为 todo 且同项目全部直接依赖可读并 done 的 task，
按 P0 → P3、ID 排序；next 是首项或 null。in_progress 单独列出，done 与 epic 不推荐。
依赖可以在 Plan 外，但不能跨项目；查询只检查直接依赖。未物化时成功返回空推荐与诊断；
映射任务不可读进入 diagnostics，不推荐。未知/损坏 Plan、workspace/project 错误或参数错误
返回 `{ok:false,error}`、退出 1，JSON 模式只写 stdout。没有可开始任务不代表失败。
Workbench Plan 详情复用相同查询展示三类任务与依赖原因，可点击任务进入 Backlog 详情。
这是只读建议；Agent 仍按任务验收、实际依赖与用户阶段确认推进，命令不自动改状态或启动执行。

## Plan：显式标为完成

所有映射 task 落地后，在 Web Plan 详情点击“标为完成”，或运行：

```bash
pops plan show projectops "$plan_id" --json
pops plan complete projectops "$plan_id" --expected-revision "$plan_revision" --json
```

从 show 顶层 `revision` 取得 plan_revision。成功返回 `{ok:true,data:{plan,revision,no_op}}`，退出 0；
失败返回 `{ok:false,error:{code,message}}`，退出 1；JSON 模式只输出 stdout。
要求 approved 且已物化、至少一个 task、所有映射可读且全部 task done（epic 不要求 done）；
已有最新串行/并行 run 还须通过完成证据校验。串行 Plan 结案使用 run 保存的完成基线，不要求当前 Repo 快照保持不变；仍校验当前任务输入、验收及证据完整性。Report 发布和运行中的基线门禁继续检查当前代码。未满足条件或 stale revision 时不写入。
同当前 revision 重复完成 done Plan 返回 no_op；旧 revision 必须重新读取。

完成操作只将 status 改为 done，不修改任务、批准、mapping 或执行快照，也不生成报告。
done 计划不能修订、重新批准或创建新 run；后续范围另建计划。Backlog 后续变化不会自动撤销 done，
Report 仍校验当前任务与执行证据。Web 冲突后使用 Refresh 核对最新版本再提交。

## Report：依据实际结果交付

从同一项目的一份已批准、已 materialize Plan 生成 Report。所有映射 task 为 done 时才能得到 completed；
有未完成 task 时，只有用户已明确接受该具体 partial 范围，才能提供非空 `--partial-acceptance`。
CLI 保存调用方给出的说明，不会验证用户授权，也不会执行 verification 字符串中的命令。

```bash
pops report create projectops "$plan_id" --verification "$verification_evidence" --repo-doc README.md --json
pops report list projectops --json
pops report show projectops "$report_id" --json
```

`report_id` 取创建结果的 `report.id`。verification 必须至少一条，写实际执行及结果；可重复传
`--verification`、`--deviation`、`--workaround`、`--repo-doc`。正文可用 `--body-file`。
`--repo-doc` 是 Repo 相对路径，Plan/Backlog 引用由产品生成 logical URI。Report 不覆盖已有文件。
正文允许“文本/JSON”“编辑/审批”等普通斜杠表述；独立或由空白、引号等分隔的机器绝对路径仍会被拒绝。
create 收据保留输入正文，写入时移除正文末尾空白并以一个换行结束文件；show 返回的正文不含该文件末尾换行。
比较 create 与 show 的正文时使用 `body.trimEnd()`，正文内部空白不做规范化。
失败后先 show/list 核对。Plan 详情会关联全部同项目报告，按生成时间降序显示；报告是创建时快照，
不能用已有 completed/partial 报告代替当前 Backlog 状态检查。点击报告可进入详情，再返回原 Plan。普通单项任务直接交付验证结果，不为报告补造 Plan 或虚构 partial 接受。

## Retrospective：捕获与后续流转

只在共享规则的回顾触发条件成立时捕获真实摩擦；主任务不扫描历史回顾，也不自动扩展为 triage 或修复。
自身 dogfooding 记录进入 ProjectOps manifest 指定的 workspace-level store；全局/跨项目事项仍走 Workspace 路由。
`retrospective.md` 必须包含三个有正文的 Markdown section：`Hidden friction encountered`、
`Workarounds used`、`Improvement candidates`。

```bash
pops retrospective capture --trigger workflow-friction --harness "$harness" --model "$model" \
  --project projectops --task "$item_id" --body-file retrospective.md --json
```

记录实际发生摩擦的 harness 与准确 model，无法确认 model 时传字符串 `null`，不猜历史执行载体。
从结果 `retrospective.id` 取得 `retro_id`。下述命令用于另行授权的查询、分类与结案工作：

```bash
pops retrospective list --status inbox --project projectops --json
pops retrospective show "$retro_id" --json
pops retrospective triage "$retro_id" --to active --expected-revision "$retro_revision" \
  --disposition actionable --owner-scope project --category tooling --next-action "$next_action" --json
pops retrospective show "$retro_id" --json
pops retrospective archive "$retro_id" --expected-revision "$retro_revision" \
  --action-disposition resolved --resolution-note "$resolution_note" --json
```

每次写入前从 show 顶层取得新的 `revision` 赋给 `retro_revision`，不能沿用 triage 前的值执行 archive。
triage 允许 inbox → active|archive，archive 允许 active → archive；后者在实际处理完成后填写结案证据。
archive 可重复传 `--backlog project-ops:backlog/items/<ID>.md` 关联自身条目。
成功流转会移动唯一记录并重建索引；revision 过期或目标冲突时保留原记录，重新读取后再判断。
不手工移动文件或编辑派生索引。

## Docs、Web 与验证边界

`pops docs scaffold projectops --json` 仅按需生成缺失的四份固定文档，已有普通文件跳过；
`pops docs check projectops --json` 只检查 README、AGENTS、产品规格与架构文档的文件类型及一级标题。
它不会检查本文、链接、内容新鲜度或语义一致性；Agent 需另行检查契约与入口链接。

Overview 的任务、计划、报告和回顾标题可直接进入详情，支持复制链接、新标签页打开和刷新定位。
详情提供“返回 Overview”，当前页面会话内恢复来源滚动位置；回顾链接显式携带当前项目筛选。
Overview 文档面板提供四份标准文档的直接链接与逐项问题，可读但不满足标准检查的文档仍可进入正文。
回顾卡片摘要由正文派生，最多显示 160 个字符，完整内容在详情阅读；预览数和状态计数均限定当前项目，
读取异常时显示诊断和已读取数量，不能把该数量当作完整 store 总数。

Workbench 可浏览 Backlog 并在详情顶部修改状态；done 分组默认折叠并显示数量，进入已完成目标时展开，用户可再次收起。revision 位于技术信息中。各领域正文默认阅读排版，
可切换 Markdown 源码；Plan 通过任务目录定位正文，审批与 mapping 位于计划记录中。Plan 另有实时执行进度，按 task 计数，epic 不计入完成率；
缺失或损坏任务仍占总数并显示诊断，未物化/零 task 不显示虚假的完成率。CLI 更新任务后点击 Refresh 查看最新进度，
进度查询不自动改写 Plan；全部落地后可显式标为完成。点击 Plan 映射任务进入 Backlog，完成状态更新后点击“返回原 Plan”
会重新加载进度与推荐并定位原计划。链接可直接打开/刷新；失效任务显示错误并保留返回入口。未完成 Plan 可预览并确认修订，也可显式标为完成；Report、Docs、Retrospective 页面只读。任务详情也提供执行记录、控制和验收入口；创建及其他未提供的流转使用 CLI。
Docs 可阅读四份标准文档和 `docs/` 下其他 Markdown，标准检查错误不阻止可读正文，扩展文档不参与标准检查。
支持章节目录、相对 Markdown 链接和源码切换；路径范围受限，符号链接目标/祖先被拒绝。HTTP list/show
为 `GET /api/projects/<id>/docs` 与 `GET /api/projects/<id>/docs?path=<repo-relative-path>`；未新增 CLI 子命令。
Report 的 Plan/Backlog/Repo docs 和回顾的关联任务可点击，通过“返回来源页面”往返。回顾详情和筛选条件、
Docs 目标与章节写入地址；滚动和展开状态在当前页面会话内恢复。Mermaid 使用本地官方 runtime 渲染，语法错误及图片节点保留源码；图片不加载。
Research 使用 manifest 登记的 `markdown/research@1` root，提供只读列表、正文、章节和相对 Markdown 链接，目标与章节写入地址；可用浏览器前进/后退返回来源。
HTTP `GET /api/projects/<id>/research` 返回列表，`?path=<root-relative-markdown-path>` 返回正文；只接受单个 path 参数，无写入入口。
空目录显示空状态，root/descriptor 失效与无法读取目标显示诊断；目标及其子目录符号链接被拒绝。
本地服务入口和固定端口见 AGENTS.md。CLI 更新后在 Web 使用 Refresh 重读数据，不假定实时推送。
本文不是全局 skill；不能套用假定 Workspace Control schema/store 的 backlog、plan、report skill。

验证命令示例时使用受信任的隔离临时 workspace，仅写入本次创建的明确目录，不需 native helper 或
对抗性 ancestor-swap 保证。验证创建、revision 冲突、Plan 批准/materialize、Report 资格和相关回顾流程；
不使用真实条目作测试，不以 fixture 的审批与完成状态代替真实交付证据。

本地 HTTP 测试若出现 `fetch failed` / `UND_ERR_SOCKET`，保留完整错误与 server 输出，先确认服务是否成功
监听、是否提前退出，再核对 loopback、代理及 sandbox 限制；不要仅凭错误字符串断定环境故障。
既往 sandbox 外运行和独立浏览器验证曾通过，可作为定位线索；需要升级执行权限时遵循当前审批规则，
不自动提权、盲目重试或把浏览器通过视为全部 HTTP 测试通过。浏览器 profile 被占用时可使用独立测试 context，
不关闭用户浏览器。


## 内容编辑与计划修订

Backlog 内容修改要求当前 revision；标题/正文可分别提供，但不能与 `--status` 混合。
正文中的验收要求与其他 Markdown 内容作为同一 body 保存，不增加第二份 acceptance 文本 authority。

```bash
pops backlog show projectops "$item_id" --json
pops backlog update projectops "$item_id" --title "更新后的任务" --body-file task.md \
  --expected-revision "$item_revision" --json
pops plan show projectops "$plan_id" --json
pops plan revise projectops "$plan_id" --input revised-draft.json \
  --expected-revision "$plan_revision" --json
```

`plan show` 返回顶层 Plan 和计算得到的 `revision`，输入草案仍为 title/goal/items。
`plan revise` 返回 `{ok:true,data:{plan,revision,applied,confirmation_token,changes,affected_items}}`；
首次调用仅预览，不写文件。核对候选与受影响条目后，用完全相同输入、旧 revision 和返回 token 确认：

```bash
pops plan revise projectops "$plan_id" --input revised-draft.json \
  --expected-revision "$plan_revision" --confirm "$confirmation_token" --json
```

确认不是自动重试；冲突必须重新读取和预览。用户在当前会话已经明确授权的修订可以直接确认该具体预览。
已物化计划只修改未开始、无执行历史且未独立编辑的任务；keys/mapping 保持不变。
物化后新增/移除/改名 key、修改 item_type/parent 返回明确错误，另建后续计划，不手工改 mapping 或复制原任务。
已批准 Plan 的修订确认更新 approval note；执行记录中的旧输入快照保持不变。
Web 提供对应内容编辑和修订预览，revision 冲突保留草稿，用户显式重读版本后再决定提交。

## 执行记录与验收

新的 workspace/project 自动声明并创建 `executions: execution/Attempt@1` root。
执行 API 只使用 manifest 解析的 root；descriptor/root 缺失或损坏时失败，不猜测或回退其他 store。
执行快照要求登记 Repo 为 Git 仓库，支持尚无 commit 的仓库；其他 ProjectOps 功能仍不要求 Git。

以下 CLI 记录外部完成的工作，不启动 Agent，也不会执行 `--command` 字符串。
调用方负责提交真实结果；证据复制到 executions/evidence，不能只引用临时日志。

```bash
pops execution create projectops "$item_id" --instructions "本次具体指示" \
  --expected-revision "$item_revision" --json
pops execution list projectops --item "$item_id" --json
pops execution show projectops "$attempt_id" --json
pops execution finish projectops "$attempt_id" --outcome succeeded --summary "实际工作结果" \
  --expected-revision "$attempt_revision" --json
pops execution verify projectops "$attempt_id" --command "实际运行的命令" --outcome passed \
  --evidence-file verification.txt --expected-revision "$attempt_revision" --json
pops execution accept projectops "$attempt_id" --note "验收依据" \
  --expected-revision "$attempt_revision" --json
```

每一步先从最新 receipt 或 show 取得新的 attempt revision；不能连续使用旧 revision。
execution 成功统一 `{ok:true,data:...}`，失败 `{ok:false,error:{code,message}}` 且退出 1。
list 的 `data.attempts` 为尝试列表；create/show/finish/verify/accept/rework 的 `data.attempt` 为完整记录，
`data.diagnostics` 表示证据不可读或变化等问题。task revision 与 attempt revision 是不同值。

执行状态、验证结果与验收结论分别记录。accept 要求执行 succeeded、当前代码快照下每个已记录命令的最新结果通过、
证据 SHA256 未变、任务输入 revision 未变、没有后继尝试；否则拒绝。accepted 才将任务设为 done。
没有执行记录的普通手工任务仍按原 status update 工作流推进。
失败、中止或要求继续保留历史；新尝试明确引用前次尝试并读取当前输入，禁止覆盖历史：

```bash
pops execution rework projectops "$attempt_id" --note "需修改的问题" \
  --expected-revision "$attempt_revision" --json
pops execution create projectops "$item_id" --retry-of "$attempt_id" \
  --expected-revision "$item_revision" --instructions "本次继续的范围" --json
```

重复 rework/accept 不产生相反结论，先 show 核对已持久化决定。
Web 任务详情可刷新查看输入、代码 diff、检查与证据诊断，并执行验收或要求继续。
HTTP endpoint 为 `/api/projects/<project>/executions`（GET 可用 `item_id`），详情为 `/<attempt>`；
`POST /start` 使用 item_id、任务 expected_revision、instructions 和可选 retry_of、model；
`POST /<attempt>/stop|confirm-interrupted|decide` 使用尝试 expected_revision，后两项还含 note，decide 另含 accepted/rework decision。
默认服务没有 runner，列表的 runner_available 为 false，网页禁用启动/重试；通过 Workbench `--pi` 参数启用真实 Pi 0.85.0 runner。

运行控制的 stop_requested 不等于停止成功。服务重启后只把其管理且无法确认的活动记录标为 unknown，
不改变 external CLI 记录。unknown 必须人工检查旧工作确已停止后填写说明，确认后才能重试：

```bash
pops execution recover projectops --json
pops execution confirm-interrupted projectops "$attempt_id" --note "已检查并确认旧工作停止" \
  --expected-revision "$attempt_revision" --json
```

recover 只在原服务 owner 已退出且需要核对时使用，不对正在运行的服务执行。
本版不自动恢复进程或重放工作；不记录凭据到输入、diff 附件或验证证据中。执行记录不是 Pi session 的副本。


## Pi 工作进展与追加指示

Workbench `--pi` 使用本机 Pi 的模型、凭据、AGENTS 与 skills，禁用 extensions/templates/themes，工具限定 read/bash/edit/write。无需给浏览器提供凭据。
`GET /api/models` 返回 `{ok:true,data:{available,models:[{provider,id,name}]}}`；available 表示执行器支持模型选择，
models 为空时应在本地 Pi 完成认证后刷新，读取失败返回不含原始配置的错误。无认证写接口。
任务 start、串行 plan-runs POST、并行 parallel-runs POST 接受可选 `model:{provider,id}`；null 或省略使用 Pi 默认模型。
只允许 provider/id 两个非空字符串字段，失效模型拒绝启动。默认模型按目标 Repo 的 Pi 设置在创建时解析成具体模型。
模型保存在 attempt.input.model 或 run.model；run 后续派发、恢复和重试沿用快照，不接受控制请求更改模型。
浏览器的切换只影响新启动的独立任务和新创建的 run；Pi 实际使用的模型独立保存在 progress.model。
`POST /api/projects/<project>/executions/<attempt>/steer` 接收 `expected_revision` 与非空 `message`；只允许当前 running 且有活跃 handle 的尝试。
`progress.events` 保存有界进展，`progress.session_id` 关联 runtime 内 Pi session。页面自动刷新，CLI show 同样可核对；进展不是验证证据，成功结束仍须 execution verify 和显式 accept。
实际开发遵守任务前置；同项目其他活动或 unknown 尝试会阻止新的单任务 Pi 工作。请先确认旧工作，再决定停止、重试或继续。

纯进展事件写入保留当前控制 revision；停止、追加指示和生命周期变更仍更新 revision 并校验 CAS，持续输出不会使控制操作持续冲突。

验证结果提供“查看证据正文”。GET `/api/projects/<project>/executions/<attempt>/evidence?ref=<exact-ref>` 只接受该尝试的验证引用，核对静态 containment 与完整内容 SHA256 后返回最多 65,536 字符预览及 truncated 标记；缺失或篡改返回诊断，页面清除旧正文，不能以旧预览冒充当前有效证据。


## Plan run 的创建与控制

`pops plan-run create <project> <plan> --expected-revision <plan-revision> --json` 冻结当前已批准物化 Plan；返回 `{ok:true,data:{run,diagnostics}}`。
`list` 返回 `data.runs`（最新在前），`show` 返回 `data.run`；mutation 使用 run.revision，与 Plan/attempt revision 不同。
`pause`、`resume --note`、`close-stopped --note` 必带 `--expected-revision`；恢复时若代码基线变化，还须核对并传 `--baseline-digest`，不能仅为绕过诊断盲传。
CLI 不创建短命 Pi 进程来冒充持续调度；Workbench 的同一 runtime 持有 handles 并自动推进已启动 run。Web 提供创建/启动、暂停、停止、恢复、终止入口。

完成前必须核对实际 run/node/attempt、验证与验收证据；Backlog done 或已有 Report 不替代依赖满足事实。unknown 必须先核实旧工作停止再确认中断。
同项目旧 run 未终止时不新建，不能以删记录或复制计划绕过。输入修订导致旧 run 无法继续时，保留旧快照并终止，再以新版本建 run。


## 有限并行 Plan run

Plan 的可选 `execution_policy` 目前仅接受 `{ "max_parallel": 2 }`；item 可声明 `parallel: true` 与唯一资源键数组 `resources`。未声明不能推定并行许可。该策略属于 Plan revision，修订采用已有 preview/apply 流程。

`pops parallel-run create <project> <plan> --expected-revision <plan-revision> [--base-commit <commit>] [--commands-file <JSON-file>] --json` 只冻结并准备，不派发。commands-file 为非空 argv 数组的数组；默认候选验证包含 npm ci、test、typecheck、build。`list [--plan <plan>]`、`show` 返回原生 receipt。`pause`、`resume --note [--integration-head <inspected-head>]`、`close-stopped --note`、`rework --node <key> --note` 使用最新 run revision。运行与落地由 Workbench 同一 runtime 持有。

受管节点执行记录携带 checkout ownership；快照、diff、verify、accept 均解析该 checkout。节点成果必须先在自己的 worktree 提交，再执行 verify 与 accept；dirty checkout 不允许接受。不要在原 Repo 提交节点成果，也不要改写受管 integration ref。接受后仍须落地边界复验；下游只认已落地的上游。落地失败后如需改代码，使用 parallel-run rework，保留旧验收、失败证据，创建新 checkout/attempt。

HTTP 集合入口 `/api/projects/<project>/parallel-runs`，详情与控制在 `/<run>`；集合 POST 创建，详情下 POST `advance`、`pause`、`resume`、`close-stopped`、`land`、`rework` 控制运行。浏览器不能提交执行命令、base commit 或工作目录，配置来自服务端。单任务、串行 run 和并行 run 共享活动/unknown 排他边界，不用新 run 绕过未结束工作。

并行完成 Report 校验最新 run、Plan/任务输入、节点接受及完整证据、landing 证据、实际 integration ref/head 与祖先关系；仅 Backlog done 不足以声明 completed。结束范围不会删除失败 worktree 或历史，用户自行决定最终目标分支合入。

## 开发服务配置检查

配置 authority 是 `.pops/workspace.json` 的 `projects.<id>.dev`，首版通过明文编辑；不自动修改真实服务登记。
字段与占位符见 PRODUCT_SPEC 的“开发服务配置”。先核对工作区保留端口，再运行：

```bash
pops dev ports --json
pops dev check <project> --json
pops project doctor --json
```

ports 返回 `{ok,projects,ports,problems}`，projects 为解析后的配置（command/cwd/env），ports 为
`{project,endpoint,host,port,origin}`。check 返回 `{ok,project,configuration,ports,problems}`，ports 额外包含
`status: free|managed|external|error` 及可选 issue。CLI 通过实际 manager 的 running 配置快照提供 owned endpoint；unknown 会阻止 check 成功。无 dev 或未知 project 的 check 返回失败诊断。全 manifest 配置冲突阻止 check 探测。
结构无效返回 `{ok:false,error:{code:"DEV_CONFIG_INVALID",message}}`；正常诊断放在 problems，失败均退出 1。
默认文本输出相同端点与诊断。不支持 `--all`；查询不启动进程或写入文件。


## 独立开发服务生命周期

`pops dev start/status/stop/restart <project> [--json]` 与 `pops dev manager stop [--json]` 调用同一 typed application/IPC。
JSON 收据为 `{ok,project,state,manager,endpoints,processes,instance?,issue?,affected?}`；state 为
`stopped|starting|running|stopping|failed|unknown`，manager 为 `running|stopped|unknown`。
processes 仅含 name、pid（也是该进程组 ID）、state、最多 4096 字符 log，不返回进程 env 或完整配置；affected 仅用于 manager stop。
错误返回 `{ok:false,error:{code:"DEV_RUNTIME_ERROR",message}}`，失败退出 1。默认文本显示项目、状态和诊断。

start 可 bootstrap workspace 唯一 manager，restart 对 stopped 等价 start；status、check、stop 不拉起 manager。
无 manager 返回 stopped，遗留 socket/lock 或活动 ledger 返回 unknown。启动有 8 秒端点就绪期限；停止每组先 TERM 等待
1 秒，仍有活跃后代则 KILL 再等 1 秒；未确认清理成功的 unknown 禁止重启。IPC 单请求最多 4096 bytes，响应最多 1 MiB，
请求总等待最多 15 秒。启动 manager 的等待最多 3 秒；并发 start 最多另等 2.5 秒当前 bootstrap，不自动抢旧锁。

`.pops/runtime/dev/` 保存 socket、lock.json、ledger.json（last owner PID/instance/项目状态），不是业务 authority。
status 失联时先读取 ledger 并人工检查命令、cwd、启动时间、进程组和后代；PID 可能复用，不能直接据此 kill。
核实所有旧进程已停止后，只删除当前 workspace 的 `socket`、`lock.json`、`ledger.json`；若有中断写入留下的
`ledger.next`，同样先确认 owner 已停止后单独删除。然后显式 start。端口空闲不能单独证明旧进程全部退出。
版本不兼容先核对正在受管的服务，再使用相容 CLI 显式 manager stop；不能用新版本自动接管。
CLI 超时或响应失联不表示操作回滚，先查询 status，避免盲目重复操作。

Workbench 的项目 Overview 可控制同一独立 manager。`GET /api/projects/:id/dev` 只读；`POST` 的 JSON body
仅允许 `{"action":"start"|"stop"|"restart"}`，不接受 workspace、socket、argv、cwd 或 env。响应沿用 application
`ok/data` envelope；data 含 `configured`、`hosts_workbench`、`status`（DevStatus）及 `problems`，服务失败事实在
`status.ok/state/issue` 中，不能将成功 HTTP envelope 误读为启动成功。请求边界/连接错误使用 `ok:false/error`。
网页不提供 manager stop；承载当前 Workbench 的登记端口禁止 Web/API stop/restart，改用 CLI。
