---
name: projectops-workflow
description: 使用 ProjectOps pops CLI 推进项目任务、计划、执行验收与交付，或处理串行/有限并行运行的暂停和恢复。适用于 ProjectOps manifest 管理的数据，不用于 Workspace Control 既有 store，也不替代项目代码开发规则。
---

# ProjectOps 工作流

这是 Repo 随附的操作入口。先读取目标 Repo 的 AGENTS.md，确认用户范围、数据 workspace 和项目 ID。
命令参数、schema 与 JSON 返回值以当前构建的 CLI help 和 [Agent 操作契约](../../docs/AGENT_CONTRACT.md) 为准；本文负责选择步骤与判断能否继续。
本 skill 随 ProjectOps Repo 分发，引用相对此目录解析，不单独复制到其他位置。

## 路由与准备

- ProjectOps manifest 与 Workspace Control Catalog 是不同 authority。只对 ProjectOps 管理的新条目使用此入口；旧条目留在原系统，不凭短 ID 推断 store。
- 使用明确版本的 `dist/cli.js`，在明确的数据 workspace 中执行 `project list --json` 和 `project doctor --json`。初始化只补明确缺失且已授权的部分；无效 descriptor 停止相关写入，不拼接 artifact 路径。
- 先读契约的“选择 workspace 与入口”“调用与结果处理”。CLI 输出没有统一 envelope：不能对所有命令读取 `data`，也不能以不存在 `ok` 判断失败。检查退出码及 stdout/stderr，处理 diagnostics。

## 从任务到交付

1. **确定范围**：list/show 现有任务与计划，读取正文、依赖和 revision。单项任务不制造 Plan；多项计划先 create → show → validate，取得对具体范围的批准后 approve → materialize → show 核对 mapping。已有批准沿用，不重复要求确认。
2. **选下一项**：用 `plan next` 获取建议，结合实际前置条件决定；空 next 不是完成证明。每次写入使用对应对象最新 revision，task、attempt、Plan、run 的 revision 不可互换。
3. **执行与验证**：读取契约“执行记录与验收”。外部 Agent 先 create execution 记录，再完成实际工作，以 finish 记录结果。真实运行验证命令并保存输出，然后 verify 引入证据；CLI 不运行 `--command` 字符串。代码或任务输入变化后重新检查证据是否仍有效。
4. **验收**：将执行成功、验证通过、验收结论分别记录。确认符合任务验收且在授权范围内，再 accept；已有 execution 不直接改 Backlog done。未通过时保留历史并 rework/retry，不覆盖失败记录。
5. **结案**：重新核对所有映射任务、run 与证据，使用最新 Plan revision 执行 complete。Report 记录实际验证和文档同步；未完成只能依据用户对具体 partial 范围的明确接受生成 partial。无授权不填虚构接受说明，也不为生成报告改状态。

常规命令及返回字段按契约对应章节读取，不另建一份 schema。创建结果不明确时先 list/show，避免重复创建。

## 运行模式与恢复

需要由 Workbench 持续派发，或处理暂停、unknown、并行落地时，读取
[运行模式与恢复](references/runs.md)，再读契约对应 run 章节。外部 subagent 完成任务不等于已启动 ProjectOps runtime。

遇到 stale revision，重读对象、比较新状态与原意后再决定是否写入，不去掉 revision 强行重试。
证据、依赖或运行状态不足时保留诊断，停止依赖它的后续动作。修复工具契约不属于操作任务的隐含授权。

## 隔离演练

验证此入口或演练恢复时，读取 [隔离验证](references/validation.md)。fixture 的批准、执行与验收只证明测试场景，不授权真实计划或真实运行。
