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
- 使用已安装的 `pops` 或明确构建版本的 `dist/cli.js`，在明确的数据 workspace 中执行 `project list --json` 和 `project doctor --json`。初始化只补明确缺失且已授权的部分；无效 descriptor 停止相关写入，不拼接 artifact 路径。
- 先读契约的“选择 workspace 与入口”“调用与结果处理”。CLI 输出没有统一 envelope：不能对所有命令读取 `data`，也不能以不存在 `ok` 判断失败。检查退出码及 stdout/stderr，处理 diagnostics。
- 初始化 Backlog 前读契约的“Backlog：初始化与代号”。省略代号时在当前 manifest 登记 store 内自动查重；需要固定代号用 `--id-prefix <PREFIX>`，不猜最终值，读取 `store.id_prefix`。自定义冲突/非法输入、不可读 store 或初始化锁占用时先处理诊断；不手改已有 store 前缀、迁移 ID 或删除数据绕过检查。

## 从任务到交付

1. **确定范围**：list/show 现有任务与计划，读取正文、依赖和 revision。单项任务不制造 Plan；多项计划先 create → show → validate，取得对具体范围的批准后 approve → materialize → show 核对 mapping。已有批准沿用，不重复要求确认。
2. **选下一项**：用 `plan next` 获取建议，结合实际前置条件决定；空 next 不是完成证明。每次写入使用对应对象最新 revision，task、attempt、Plan、run 的 revision 不可互换。
3. **执行与验证**：读取契约“执行记录与验收”。外部 Agent 先 create execution 记录，再完成实际工作，以 finish 记录结果。真实运行验证命令并保存输出，然后 verify 引入证据；CLI 不运行 `--command` 字符串。受管 Pi 按契约以 bash 首行 `# projectops-verify` 标记真实检查，由 runner 保存工具结果与当时代码快照，不自行调用 finish/verify/accept；普通命令和最终摘要不算验证证据。代码或任务输入变化后重新检查证据是否仍有效。
4. **验收**：将执行成功、验证通过、验收结论分别记录。确认符合任务验收且在授权范围内，再 accept；已有 execution 不直接改 Backlog done。未通过时保留历史并 rework/retry，不覆盖失败记录。
5. **结案**：重新核对所有映射任务、run 与证据，使用最新 Plan revision 执行 complete。Report 记录实际验证和文档同步；未完成只能依据用户对具体 partial 范围的明确接受生成 partial。无授权不填虚构接受说明，也不为生成报告改状态。

常规命令及返回字段按契约对应章节读取，不另建一份 schema。创建结果不明确时先 list/show，避免重复创建。

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
