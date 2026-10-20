---
name: projectops-workflow
description: 使用 ProjectOps pops CLI 推进项目任务、计划、执行验收与交付，或处理串行/有限并行运行的暂停和恢复。适用于 ProjectOps manifest 管理的数据，不用于 Workspace Control 既有 store，也不替代项目代码开发规则。
---

# ProjectOps 工作流

这是 ProjectOps 操作入口。先读取目标 Repo 的 AGENTS.md，确认用户范围、数据 workspace 和项目 ID。
命令参数、schema 与 JSON 返回值以当前构建的 CLI help 和 [Agent 操作契约](../../docs/AGENT_CONTRACT.md) 为准；本文负责选择步骤与判断能否继续。
本 skill 由 `pops init` 或 `pops skill install` 安装到 workspace；引用相对此目录解析。
先运行 `pops skill status --json` 核对分发与当前 CLI 是否匹配；安装副本不作为可编辑来源。

## 路由与准备

- ProjectOps manifest 与 Workspace Control Catalog 是不同 authority。只对 ProjectOps 管理的新条目使用此入口；旧条目留在原系统，不凭短 ID 推断 store。
- Workspace 的共享规则、skill、tooling 和跨项目过程事项，使用宿主指引指定的已登记承载项目；回顾统一通过 manifest 的 workspace-level store 捕获，不自行建立 workspace Backlog/Plan schema。
- 使用已安装的 `pops` 或明确构建版本的 `dist/cli.js`，在明确的数据 workspace 中执行 `project list --json` 和 `project doctor --json`。初始化只补明确缺失且已授权的部分；无效 descriptor 停止相关写入，不拼接 artifact 路径。
- 先读契约的“选择 workspace 与入口”“调用与结果处理”。CLI 输出没有统一 envelope：不能对所有命令读取 `data`，也不能以不存在 `ok` 判断失败。检查退出码及 stdout/stderr，处理 diagnostics。
- 初始化 Backlog 前读契约的“Backlog：初始化与代号”。省略代号时在当前 manifest 登记 store 内自动查重；需要固定代号用 `--id-prefix <PREFIX>`，不猜最终值，读取 `store.id_prefix`。自定义冲突/非法输入、不可读 store 或初始化锁占用时先处理诊断；不手改已有 store 前缀、迁移 ID 或删除数据绕过检查。

## 选择执行路径

按任务的跟踪、调度和交接需要选择最短适用路径；测试策略独立遵循 Repo 与共享规则。

| 需要 | 路径 |
|---|---|
| 当前会话可完成，无持续跟踪需要 | 直接实施 → 验证 → 回复；不自动创建 Backlog、Plan、execution 或 Report |
| 需要排期、跨会话续做或保留任务状态 | 使用 Backlog，正文记录范围与验收；实施、验证后更新状态并记录结果。无 execution 的任务可直接更新 done |
| 需要执行快照、正式验收交接、受管调度或重试恢复 | 使用 execution；需要多项依赖规划时使用 Plan，需要持续派发或并行落地时使用对应 run |

已有任务沿用其记录；已有 execution 或 run 必须按原验收、恢复与落地契约完成，不能改走轻量路径绕过检查。
外部 Agent 身份本身不要求创建 execution；单项 execution 不要求 Plan。多项依赖规划也可仅使用 Plan/Backlog，
但跨 owner mapping 仍遵循下文的单任务 execution 要求。简单直接任务到此完成路由，不继续加载无关执行或恢复章节。

## 跟踪与正式交付

1. **确定范围**：list/show 现有任务与计划，读取正文、依赖和 revision。单项任务不制造 Plan；多项计划先 create → show → validate，取得对具体范围的批准后 approve → materialize → show 核对 mapping。已有批准沿用，不重复要求确认。
2. **推进任务**：仅有 Backlog 时按契约“Backlog：创建与推进”操作；有 Plan 时用 `plan next` 获取建议，结合实际前置条件决定，空 next 不是完成证明。每次写入使用对应对象最新 revision，task、attempt、Plan、run 的 revision 不可互换。
3. **执行与验证**：仅使用 execution 时读取契约“执行记录与验收”。外部 Agent 先 create execution，再完成实际工作，以 finish 记录结果。优先用 `execution check ... -- <program> [args...]` 运行验证并自动保存证据；已有真实输出可用 verify 登记，verify 不运行 `--command` 字符串。check 失败退出 1，即使记录成功返回 ok:true 也不能视为通过；读取 check.outcome 与诊断。受管 Pi 仍以 bash 首行 `# projectops-verify` 标记真实检查，由 runner 保存证据，不自行 finish/verify/accept。代码或任务输入变化后重新检查证据是否有效。
   已准备完整材料时，可按契约“批量提交完成材料”用 submit 减少 revision 搬运；accept 步骤只在已有明确授权和审阅依据时加入。
   失败读取 receipts、next_step 和最新 revision，核对日志后显式 from-step 继续，不重放已成功检查；收据丢失先 show 对账。
4. **验收**：使用 execution 时分别记录执行成功、验证通过、验收结论。确认符合任务验收且在授权范围内，再 accept；未通过时保留历史并 rework/retry，不覆盖失败记录。
5. **结案**：有 Plan 时核对所有映射任务、适用 run 与证据，使用最新 Plan revision 执行 complete。普通单项任务直接交付验证结果；多阶段交付的 Report 自动引用有效 execution/run 验收与验证证据，补充偏离、workaround 和文档同步；无 execution 的交付仍须提供真实 verification。未完成只能依据用户对具体 partial 范围的明确接受生成 partial，不为生成报告改状态或补造 Plan。

常规命令及返回字段按契约对应章节读取，不另建一份 schema。创建结果不明确时先 list/show，避免重复创建。
execution 日常使用 `--json --view summary` 并复用收据的新 revision；需要输入、diff 或完整历史时再 show full。
精简收据不替代证据审阅；check 报告独立保留输出时先核对最新状态与日志，不盲目重跑。

## 跨项目物化与依赖

- 先从当前 manifest 核对目标项目和实际 task ID。Backlog 使用 `project:ID`，Plan 混用局部 key 与限定既有引用；同项目既有任务也必须限定项目。按契约提交完整依赖集合，更新携带最新 revision，删除全部用空集合。
- 引用只读连接上游，不复制、不修改或启动外部任务。Plan mapping 和交付范围包含该 Plan 在各目标项目的新建项，既有前置不计入；跨 Repo 操作需要相应授权。
- 上游未完成时可以建立引用并物化 Plan；用 `plan next` 和依赖详情核对阻塞，再在上游项目推进后刷新。缺失/不可读/取消或无有效接受及 landing 的前置不能视为完成。
- item 的 `project` 默认 Plan owner；跨项目创建前核对所有目标已登记且 Backlog 有效。从 receipt 读取 mapping（owner 裸 ID 或 `project:ID`）和条目项目，不预测 ID；物化后不能修订目标项目。
- 物化失败先 show Plan 和各目标 Backlog，按 source 与 receipt 核对已创建事实，再修复诊断并重试 materialize；`state: partial` 禁止 revise、complete、Report 和 run，不能当作用户接受的 partial 交付。来源/内容冲突时先人工核对，不删除或盲目重建。
- 跨 owner mapping 的计划在各任务真实项目创建、验证并接受单任务 execution，由 owner 汇总 complete/Report；两类自动 run 均拒绝创建、启动及恢复。
- 全部 mapping 属于 owner 时，创建串行/并行 run 前确认跨项目前置满足；运行冻结完成依据，派发、恢复和结案重新验证。依据变化按契约暂停或终止后新建，不手改快照、不用新的 run 绕过诊断。

## 运行模式与恢复

需要由 Workbench 持续派发，或处理暂停、unknown、并行落地时，读取
[运行模式与恢复](references/runs.md)，再读契约对应 run 章节。外部 subagent 完成任务不等于已启动 ProjectOps runtime。

遇到 stale revision，重读对象、比较新状态与原意后再决定是否写入，不去掉 revision 强行重试。
证据、依赖或运行状态不足时保留诊断，停止依赖它的后续动作。修复工具契约不属于操作任务的隐含授权。

## 隔离演练

验证此入口或演练恢复时，读取 [隔离验证](references/validation.md)。fixture 的批准、执行与验收只证明测试场景，不授权真实计划或真实运行。


## 开发服务

项目本体开发进程使用 `pops dev`，不创建 Pi execution 或 Plan run。先按 Agent 契约核对 dev 配置和工作区端口，
check 后显式 start；status/check 不启动 manager。停止单项目用 dev stop，停止 workspace 全部受管服务才用
`dev manager stop`。unknown、版本不兼容或 IPC 失联先按契约检查 ownership，不根据遗留 PID kill 或盲目重启。
