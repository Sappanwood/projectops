# 运行模式与恢复

具体命令、参数及 JSON 字段读取 [Agent 操作契约](../../../docs/AGENT_CONTRACT.md) 的“执行记录与验收”“Plan run 的创建与控制”“有限并行 Plan run”。

| 需要 | 选择与边界 |
|---|---|
| Agent 在 CLI 外完成工作 | execution create/finish/verify/accept；CLI 只记载事实，不启动执行器 |
| 持续串行派发 | Workbench 同一 runtime 持有 handles；plan-run create 只冻结，不在 CLI 启动短命 Pi |
| 有限并行 | Plan 显式 max_parallel: 2、节点 parallel 与 resources；未声明不推定许可。parallel-run create 只准备，不派发 |

单任务、串行、并行共享同项目活动/unknown 排他边界。旧 run 未终止时不复制 Plan、新建 run 或删除记录绕过。
运行许可也不等于验收许可；进展事件和 Agent 的成功摘要不是验证证据。

## 暂停、停止与 unknown

1. show 最新 run/node/attempt 和 diagnostics，确认原 runtime 是否仍活跃。
2. pause 表示停止继续派发；已有工作可能仍在运行。`stop_requested` 只是请求，不能报告“已停止”或据此启动重试。
3. 只有原服务 owner 已退出且需要核对时使用 execution recover。unknown 表示无法确认；检查旧工作确已停止，记录实际检查依据后 confirm-interrupted。
4. 再 show，按实际结果选择 retry/rework、resume 或 close-stopped。resume 使用新 revision 和必要说明；基线变化时先检查实际差异，再提供契约要求的 baseline digest/integration head。
5. 输入修改使旧 run 无法继续时，保留快照并终止旧 run，再以新版本创建。不能把新基线参数当绕过检查的通行证。

若无权检查旧进程或无法证明停止，报告阻塞，保留 unknown；不能用等待时间替代停止证据。

## 并行节点的验收与落地

在节点受管 worktree 修改并提交，再 verify/accept；dirty checkout 不可接受。不要在原 Repo 提交节点成果，也不直接修改受管 integration ref。
accepted 与 landed 不同：下游依赖只认已落地成果；落地还会复验。失败后需要改代码时用 parallel-run rework 创建新 checkout/attempt，保留失败与旧验收。
完成时核对最新 run、输入、节点证据、landing 证据和实际 integration head。Report completed 不能仅由 Backlog done 推断；最终目标分支合入需在用户授权范围内单独处理。
