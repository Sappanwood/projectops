# AGENTS.md — ProjectOps 开发路由中枢

> 人类开发者请阅读 [README.md](README.md)。共享行为规则与 Workspace Catalog 路由遵循
> `/home/ling/workspace/AGENTS.md`。

## 项目定位

ProjectOps 是面向人类开发者和 Coding Agent 的本地 Project Operations 产品。最终通过 `pops` CLI 和
Local Web Workbench 管理项目注册表、Backlog、Plan、Delivery Report、项目文档体系和 Workflow Retrospective。

当前为 Greenfield Alpha，不承担现有 Workspace Control 的兼容、迁移或双写责任。现有系统只作为需求和行为参考。

## 当前阶段：Alpha 快速迭代

本项目当前以验证产品工作流和快速迭代为首要目标，不以生产级完整性为验收标准。

### 实现原则

- 优先交付可运行的端到端纵向切片。
- 优先实现明确的正确工作流和高频用户路径。
- 不为假设性的未来需求建立抽象、扩展点或兼容层。
- 不主动实现低概率 edge case；真实发生后再补充处理和回归测试。
- 不承担历史版本兼容或 deprecated API；仅按下述 dogfooding 规则迁移自身活动数据。
- 可以接受局部重复；只有重复已经阻碍修改时才重构。
- 可以暂不提供跨进程事务、崩溃恢复、严格原子性和复杂并发保证。
- 产品威胁模型限定为受信任的本地用户和受信任的 workspace。
- 不承诺抵抗恶意 symlink、ancestor swap 或同用户对抗性并发。
- 不引入数据库、缓存、通用插件系统或多运行时，除非当前工作流已经证明需要。

### 测试策略

- 不设置 coverage 百分比门槛。
- 测试以正确工作流、核心 use case 和端到端 smoke 为主。
- 每个主要能力至少保留一个代表性 happy-path 测试。
- Bug 真实出现后补充能够复现问题的回归测试。
- 不要求穷举非法输入、罕见平台差异和理论并发边界。
- 纯样式、文案、模板和低风险配置修改允许只做针对性验证。
- 测试若明显拖慢早期设计调整，优先缩小测试范围，不固化尚未稳定的内部实现。

## 绝对红线

- 使用 Node.js 22+、TypeScript 和 npm；生产代码保持单运行时。
- CLI 名称为 `pops`；Repo 和 Catalog project id 为 `projectops`。
- 业务 authority 使用可读、可版本控制的 Markdown 或 JSON；不以数据库作为业务 source of truth。
- CLI、Web 和未来 Agent 接口必须调用同一 application/domain 实现，不通过内部 CLI subprocess 拼接业务能力。
- 各领域保留自己的 schema 和 lifecycle；不建立万能 Artifact CRUD 或统一状态机。
- 不静默覆盖已有用户文件；覆盖必须由用户显式指定。
- 文件写入目标必须显式、有限且位于当前命令声明的 workspace 内。
- 不执行无边界递归删除。
- 代码注释和 Docstrings 使用英文；对话与文档使用简体中文。

这里的文件写入和删除规则是开发最低保护线，不代表产品已经承诺 production-grade containment、原子性或并发安全。

## 自身 dogfooding 与数据演进

- 自身 dogfooding 与已获 Workspace 授权的真实项目使用 ProjectOps；新增真实项目的范围以 Workspace `AGENTS.md` 为准。
- 新产生的自身开发 Backlog、Plan、Report 和 dogfooding 回顾由 ProjectOps 管理，同一条目只有一个 authority，不双写。
- Workspace Control 的既有条目（包括仍未完成的条目）留在原系统处理，不导入、不迁移，也不复制为自身条目。
- active item 指 dogfooding 过程中产生且仍在使用的条目，不是某个领域的固定 status 值；迁移前明确实际清单及必要引用。
- schema 变化只迁移上述活动数据。运行时只支持当前 schema，不增加旧版读取、自动升级、双写或兼容分支。
- 迁移采用针对实际数据的一次性脚本，先保留可恢复副本，再迁移并验证内容、状态、ID、依赖和跨 artifact 引用；
  验证失败时保留恢复材料，验证成功后删除脚本，不建设长期 migration framework。以 Git diff 或交付记录保留迁移与验证证据。
- 已完成或归档条目不要求持续迁移；无法读取的旧版本应明确显示版本不支持，不静默丢弃或阻断有效活动条目。
  活动条目仍引用的历史数据须在迁移清单中明确处理，不能留下失效引用。
- 一次性迁移仍遵守受信任本地 workspace、有界写入和显式覆盖规则，不增加恶意 ancestor-swap 防护或 native helper 要求。

## Project Ops 路由

自身数据 workspace 为 `/home/ling/workspace`，唯一活动路由 authority 为其 `.pops/workspace.json`。
开始普通自身开发任务前，在该数据 workspace 运行：

```bash
pops project list --json
pops project doctor --json
```

从 manifest 的唯一 `projectops` 记录定位 Repo；Repo 定位、新过程 artifact 与开发服务均由 ProjectOps 管理。
Workspace Control 的保留登记只负责旧 artifact 的历史查询，不是普通开发的入口。
操作前从 [ProjectOps 工作流 skill](skills/projectops-workflow/SKILL.md) 进入，再按其路由读取
[Agent 操作契约](docs/AGENT_CONTRACT.md) 的 list/doctor、初始化、CLI 与 revision 流程。
artifact 路径由 ProjectOps manifest 解析，不自行拼接。
workspace skill 由 `pops init` 默认安装，已有 workspace 用 `pops skill install`；更新与恢复先读
Agent 操作契约的“Workspace skill 安装与恢复”。开发维护 Repo 内唯一来源，build 自动生成分发资料；
不修改安装副本或全局目录来代替源码变更。受管 Pi 显式发现已验证，其他外部 Agent 自动发现未验证。
全局 skill 若假定 Workspace Control store/schema，不得直接套用于自身数据；使用 ProjectOps 当前 CLI 契约。
ADR、Research 使用 ProjectOps 登记的对应 typed roots；自身 dogfooding 回顾使用其 workspace-level Retrospective store。
跨项目或全局工作流事项仍遵循 Workspace 路由。

只有显式处理 Workspace Control 既有条目时，才运行旧 resolver 并使用其 exact roots 与原有工具：

```bash
/home/ling/workspace/workspace-control/bin/workspace project resolve projectops \
  --catalog /home/ling/workspace/workspace-control/catalog/workspace.json --json
backlog --store <resolved-artifacts.backlog.root> <command> --json
```

## 路由表

| 文档或 artifact | 何时读 | 何时更新 |
|---|---|---|
| [skills/projectops-workflow/SKILL.md](skills/projectops-workflow/SKILL.md) | Agent 操作 ProjectOps 数据、执行验收或恢复 run 前 | 工作流决策、恢复路径或 skill 接入变化时 |
| [docs/AGENT_CONTRACT.md](docs/AGENT_CONTRACT.md) | Agent 操作自身过程数据前 | CLI 参数、输出、生命周期或操作流程变化时 |
| [README.md](README.md) | 了解安装方式、代码检查入口和当前可运行能力时 | CLI、安装步骤、质量入口或用户入口变化时 |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | 修改产品范围、用户工作流或数据契约前 | 功能、用户流程、schema 或版本路线变化时 |
| [docs/FRONTEND_GUIDELINES.md](docs/FRONTEND_GUIDELINES.md) | 修改前端控件、样式或布局前 | 共享视觉、控件状态、页面例外或前端验收规则变化时 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 修改模块、依赖方向、存储或运行形态前 | 组件关系、核心数据流或技术选型变化时 |
| `<ops-path>/adr/` | 需要查看或记录架构取舍时 | 新增、替代或废弃架构决策时 |
| `<ops-path>/backlog/` | 开始任务、查看验收范围或更新状态时 | 任务创建、状态或验收边界变化时 |
| `<ops-path>/plans/` | 执行多阶段工作前 | 新建、修订、批准或归档执行计划时 |
| `<ops-path>/research/` | 结论依赖 ProjectOps 代码或状态时 | 完成项目级调研时 |
| `<ops-path>/reports/` | 查看已完成多阶段交付证据时 | delivery completed 或用户接受 partial 后 |

表中的 `<ops-path>` 对新自身 artifact 指 ProjectOps manifest 解析出的项目 ops root；对 Workspace Control
既有 artifact 指其 resolver 返回的 root。引用既有条目时标明所属系统，不能仅凭短 ID 选择 store。

## 外部 API 文档索引

Pi SDK 固定为 `@earendil-works/pi-coding-agent@0.85.0`；查阅 [官方 SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) 与安装版本的类型声明。新增或升级 Node.js、TypeScript、npm package 或外部 SDK 集成时，先查阅对应官方文档，
不要仅依赖训练数据中的版本信息。

## 代码风格

- 使用最小实现，不预留未验证的扩展点。
- 优先纯函数和显式输入；只在当前用例需要时引入 class 或 interface。
- 不触碰与当前任务无关的代码。
- 不添加解释显而易见代码的注释。

## 常用命令

```bash
npm install
npm run dev -- --help
npm run quality
npm run format
npm run quality:full
npm test
npm run test:e2e
npm run build
node dist/cli.js --version
```

格式与基本静态检查由 `biome.json` 统一定义，适用范围及单独测试入口见
[README 开发质量检查](README.md#开发质量检查)。不得用全目录排除或关闭既定规则绕过问题。
机械格式变更与行为/结构调整分开提交；模块边界仍按架构文档审查，不以文件行数决定拆分。

## 完工验收

- 日常源码、测试、脚本和质量配置变更运行 `npm run quality`（lint、format check、typecheck）。
- 跨模块重构、质量工具或构建/测试脚本变更，以及多阶段最终验收运行 `npm run quality:full`；该入口只构建一次。
- `quality` 已覆盖 lint、format check 和 typecheck；`quality:full` 还覆盖 `quality`、build 与测试。已成功覆盖且后续改动未使证据失效的子检查无需另跑。
- 风险分级：文案/样式/简单配置可实现后验证；Bug、数据模型和状态逻辑先验证失败用例；
  CLI/API、权限、路径和并发契约采用 Red-Green-Refactor，保持 Alpha 已接受的安全边界。
- 测试失败必须区分基线失败、环境限制和新增回归，记录具体命令及诊断；不能以静态检查通过代替完整门禁。
  文件级失败、空子进程输出、loopback 代理与 Pi 配置读取的定位步骤见
  [README 测试环境诊断](README.md#测试环境诊断)。

- 前端任务按 [前端交付验收](docs/FRONTEND_GUIDELINES.md#前端交付验收) 复用控件和布局，并完成实际受影响状态的真实浏览器检查；后台和纯文档任务不承担无关视觉门禁。
- 功能变更至少运行与当前 happy path 直接相关的测试。
- TypeScript 源码变更运行 `npm run typecheck`。
- CLI 或构建入口变化运行 `npm run build` 和一次对应 smoke。
- 文档、文案和简单配置修改不要求运行完整测试。
- 根据路由表检查 `README.md`、`docs/AGENT_CONTRACT.md`、`docs/PRODUCT_SPEC.md` 和 `docs/ARCHITECTURE.md` 是否需要同步。
- 不以 coverage、理论 edge case、未声明平台或 production hardening 阻塞 Alpha 交付。
- 自身 schema 或 HTTP 契约变更并更新真实数据后，核对 ProjectOps 长期服务的监听进程、Repo cwd、
  启动命令及是否已加载本次构建。旧进程需重启时先核对活动/unknown 执行和 run，按既有控制流程处理，
  不直接中断仍在运行的工作；仅对已确认可停止的目标服务运行 `pops dev restart projectops`。
  在实际分配端口检查首页、`/api/workspace` diagnostics 及受影响 API，记录结果。
  若服务暂不能重启或核验，交付中明确说明；build 和隔离 fixture 通过不能替代真实服务验收。


## 本工作区开发服务

ProjectOps manifest 已登记 `projectops` 单端口服务，Web/API 共用 `127.0.0.1:12500`。
先在 Repo 完成 `npm run build` 和相关验证，再在数据 workspace 运行 `pops dev check projectops`、
`pops dev start projectops`；更新运行版本使用 `pops dev restart projectops`。
服务直接执行 `node dist/workbench.js`，不在 manager 的 8 秒就绪窗口中构建；CLI 退出后仍由独立 manager 持有。
该开发服务通过 `--pi` 启用本地 Pi runner，header 可选择本地已认证模型；认证由同用户的本地 Pi 管理。
端口与启动命令的唯一 authority 是 `.pops/workspace.json`；不自动导入 Workspace Control Catalog。
停止或重启自身 Workbench 使用终端 CLI，网页/API 禁止自身 stop/restart。切换前核对所有项目的受管活动/unknown
attempt 和未结束 run；不能仅检查 `projectops` 项目。恢复已验证构建的流程见 [README](README.md#自身开发服务与恢复)。
