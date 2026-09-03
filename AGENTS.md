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
- 不承担历史版本兼容、数据 migration 或 deprecated API。
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

## Project Ops 路由

开始任务前运行：

```bash
/home/ling/workspace/workspace-control/bin/workspace project resolve projectops \
  --catalog /home/ling/workspace/workspace-control/catalog/workspace.json \
  --json
```

只使用 resolved context 返回的 Repo、`ops_root` 和 typed artifact roots。Backlog 操作使用：

```bash
backlog --store <resolved-artifacts.backlog.root> <command> --json
```

## 路由表

| 文档或 artifact | 何时读 | 何时更新 |
|---|---|---|
| [README.md](README.md) | 了解安装方式和当前可运行能力时 | CLI、安装步骤或用户入口变化时 |
| [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) | 修改产品范围、用户工作流或数据契约前 | 功能、用户流程、schema 或版本路线变化时 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 修改模块、依赖方向、存储或运行形态前 | 组件关系、核心数据流或技术选型变化时 |
| `<ops-path>/adr/` | 需要查看或记录架构取舍时 | 新增、替代或废弃架构决策时 |
| `<ops-path>/backlog/` | 开始任务、查看验收范围或更新状态时 | 任务创建、状态或验收边界变化时 |
| `<ops-path>/plans/` | 执行多阶段工作前 | 新建、修订、批准或归档执行计划时 |
| `<ops-path>/research/` | 结论依赖 ProjectOps 代码或状态时 | 完成项目级调研时 |
| `<ops-path>/reports/` | 查看已完成多阶段交付证据时 | delivery completed 或用户接受 partial 后 |

## 外部 API 文档索引

当前没有第三方运行时 API。新增或升级 Node.js、TypeScript、npm package 或外部 SDK 集成时，先查阅对应官方文档，
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
npm test
npm run typecheck
npm run build
node dist/cli.js --version
```

## 完工验收

- 功能变更至少运行与当前 happy path 直接相关的测试。
- TypeScript 源码变更运行 `npm run typecheck`。
- CLI 或构建入口变化运行 `npm run build` 和一次对应 smoke。
- 文档、文案和简单配置修改不要求运行完整测试。
- 根据路由表检查 `README.md`、`docs/PRODUCT_SPEC.md` 和 `docs/ARCHITECTURE.md` 是否需要同步。
- 不以 coverage、理论 edge case、未声明平台或 production hardening 阻塞 Alpha 交付。

