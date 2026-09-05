# ProjectOps Agent 操作契约

本契约描述当前 Alpha CLI 的操作顺序与结果处理。开始任务先读 [AGENTS.md](../AGENTS.md)，
产品数据约束见 [PRODUCT_SPEC.md](PRODUCT_SPEC.md)，人工演示见 [README.md](../README.md)。
CLI 参数、输出或生命周期改变时，同步更新本文并在隔离 workspace 验证相关示例。

## 选择 workspace 与入口

本地自身 dogfooding 的数据 workspace 是 `/home/ling/workspace`；Repo 和服务定位仍遵循 AGENTS.md
中的 Workspace Control resolver。只有 ProjectOps 新产生的自身条目使用下述流程，Workspace Control
既有条目留在原系统，不导入、不迁移、不双写，也不按短 ID 猜测所属 store。

在 Repo 运行 `npm run build` 后，从数据 workspace 使用当前构建。以下 Bash 函数是会话内入口，
避免误用其他版本的全局 `pops`；后续命令均从同一数据 workspace 执行：

```bash
cd /home/ling/workspace
pops() { node /home/ling/workspace/projectops/dist/cli.js "$@"; }
pops --help
pops project list --json
pops project doctor --json
```

`.pops/workspace.json` 是数据路由 authority；project 路径与 typed artifact roots 由 CLI 解析。
缺失或无效 descriptor 时停止相关操作并报告诊断，不回退 Workspace Control roots，不自行拼接输出目录。
仅当明确缺失时执行相应初始化：

| 缺失内容 | 命令 | 边界 |
|---|---|---|
| workspace manifest | `pops init /home/ling/workspace --json` | 只初始化壳，不自动登记项目；已有 manifest 不重复初始化 |
| 自身项目登记 | `pops project add projectops --json` | 只登记 workspace 内的自身目录 |
| 自身 Backlog store | `pops backlog init projectops --json` | 已初始化时不重复执行 |

初始化后重新运行 list/doctor。真实 dogfooding 暂不接入其他项目，隔离临时 fixture 可用于验证。
schema 演进只对 dogfooding 活动数据做一次性迁移，验证后删除脚本；不增加运行时旧版读取或兼容分支。
完成/归档数据与活动引用的处理遵循 AGENTS.md；版本诊断属于演进要求，不表示当前已提供专门迁移命令。

## 调用与结果处理

Agent 优先传 `--json`，同时检查退出码、stdout 和 stderr。`init --json` 成功返回
`{ "ok": true, "workspace": { "name": "...", "manifest": ".pops/workspace.json" } }`，manifest 路径相对目标 workspace；
失败返回 `{ "ok": false, "error": "..." }` 并退出 1，两者仅写 stdout。省略 `--json` 时提供文本输出。
当前输出没有统一 envelope，不能一律读取
`data` 或要求 `ok` 字段。代表性成功结果如下：

| 命令 | 读取位置 |
|---|---|
| `init` | `workspace.name`、`workspace.manifest` |
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

Workbench 可浏览 Backlog 并在详情顶部修改状态；revision 位于技术信息中。五类内容正文默认阅读排版，
可切换 Markdown 源码；Plan 通过任务目录定位正文，审批与 mapping 位于计划记录中。Plan 另有实时执行进度，按 task 计数，epic 不计入完成率；
缺失或损坏任务仍占总数并显示诊断，未物化/零 task 不显示虚假的完成率。CLI 更新任务后点击 Refresh 查看最新进度，
不通过修改 Plan 记录推进执行状态。点击 Plan 映射任务进入 Backlog，完成状态更新后点击“返回原 Plan”
会重新加载进度与推荐并定位原计划。链接可直接打开/刷新；失效任务显示错误并保留返回入口。Plan 可预览并确认修订；Report、Docs、Retrospective 页面只读。任务详情也提供执行记录、控制和验收入口；创建及其他未提供的流转使用 CLI。
Docs 可阅读四份标准文档和 `docs/` 下其他 Markdown，标准检查错误不阻止可读正文，扩展文档不参与标准检查。
支持章节目录、相对 Markdown 链接和源码切换；路径范围受限，符号链接目标/祖先被拒绝。HTTP list/show
为 `GET /api/projects/<id>/docs` 与 `GET /api/projects/<id>/docs?path=<repo-relative-path>`；未新增 CLI 子命令。
Report 的 Plan/Backlog/Repo docs 和回顾的关联任务可点击，通过“返回来源页面”往返。回顾详情和筛选条件、
Docs 目标与章节写入地址；滚动和展开状态在当前页面会话内恢复。Mermaid 暂按代码显示，图片不加载。
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
`POST /start` 使用 item_id、任务 expected_revision、instructions 和可选 retry_of；
`POST /<attempt>/stop|confirm-interrupted|decide` 使用尝试 expected_revision，后两项还含 note，decide 另含 accepted/rework decision。
默认服务没有 runner，列表的 runner_available 为 false，网页禁用启动/重试；不能把本轮基础能力当作已接入 Pi。

运行控制的 stop_requested 不等于停止成功。服务重启后只把其管理且无法确认的活动记录标为 unknown，
不改变 external CLI 记录。unknown 必须人工检查旧工作确已停止后填写说明，确认后才能重试：

```bash
pops execution recover projectops --json
pops execution confirm-interrupted projectops "$attempt_id" --note "已检查并确认旧工作停止" \
  --expected-revision "$attempt_revision" --json
```

recover 只在原服务 owner 已退出且需要核对时使用，不对正在运行的服务执行。
本版不自动恢复进程或重放工作；不记录凭据到输入、diff 附件或验证证据中。执行记录不是 Pi session 的副本。
