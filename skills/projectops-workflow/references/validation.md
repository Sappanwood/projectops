# 隔离验证

使用调用方授权的受信任本地临时目录，创建独立数据 workspace、项目 Git fixture 和 evidence 目录。
安全边界为 trusted local directories；不要求恶意 ancestor-swap resistance，不需要 native helper。
使用当前 Repo 构建的 CLI，cwd 必须是 fixture workspace，不能沿用契约示例中的真实 workspace。
演练允许登记 fixture 项目；不修改真实 manifest、任务、执行记录、全局 skill 或凭据。

让无会话历史的独立 Agent 只从 Repo AGENTS/README 发现入口，完成以下目标。提供隔离目标和测试授权，
不要提供预期命令实现或作者结论。不能运行独立 Agent 时明确标记未验证，作者自测不替代此验收。

- 使用最小真实 Git 变更与实际验证输出，完成 Plan → Backlog → execution → verify → accept → complete → Report。
- 测试批准说明标记为 fixture-only。保存草案、任务输入、验证输出、命令 argv、cwd、退出码、stdout/stderr 与收据；分别记录执行、验证和验收事实。
- 用旧 revision 发起修改，确认拒绝并重读；无验证证据时 accept 与 completed 报告不得成功。
- 用隔离 fake runner 验证暂停、stop_requested、服务 owner 退出后的 unknown，以及人工确认后才继续。可按需读取 Repo 测试 fixture，不能接入真实 Pi 或用真实运行试错。
- 检查串行/并行模式排他和并行声明、worktree 提交/验收/落地边界。记录实际执行了哪些场景，不能把只读检查写成运行通过。

恢复场景可使用现有测试里的 fake runner 与 public application API 构造；生产 authority 仍只通过产品入口操作。
保留机器可重放输入和执行证据，清理临时服务、进程与受管 worktree。完成记录说明证据保留位置及局限。
