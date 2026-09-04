# ProjectOps 产品规格

## 产品概述

ProjectOps 是面向人类开发者和 Coding Agent 的本地 Project Operations 产品。它以 Git-friendly 的
Markdown/JSON artifact 为权威数据，通过统一 `pops` CLI 和 Local Web Workbench 管理项目工作流。

当前阶段目标是快速验证核心闭环，不提供现有 Workspace Control 的兼容层和迁移工具。

## 目标用户与使用场景

- 单机维护多个代码项目的开发者。
- 需要稳定、机器可读任务和计划契约的 Coding Agent。
- 希望把计划、任务、交付证据和工作流改进保留在 Git 中的团队。

核心场景：

1. 初始化一个 workspace 并显式登记 Repo（`pops init` + `pops project add`，两个动作分离）。
2. 创建和推进 Backlog item。
3. 编写、验证和批准 Plan，并 materialize 为 Backlog。
4. 在 delivery 结束后生成 Report。
5. 建立和检查 Repo 长期文档体系。
6. 记录、分类并处理 Workflow Retrospective。

## 核心功能

| 模块 | 目标能力 | 当前状态 |
|---|---|---|
| Workspace/Catalog | 初始化、项目注册、typed roots、doctor | 已实现（init、project add/list/doctor） |
| Backlog | Store bootstrap、CRUD、dependency、queue | 部分实现（init/add/list/show/update 与 depends_on 存储；queue 未实现） |
| Plan | authoring、查询、validation、review、approval、materialization | authoring/query/validation/approval/materialization 已实现 |
| Report | delivery evidence 生成和关联 | 未实现 |
| Project Docs | roles、templates、scaffold、check | 未实现 |
| Retrospective | inbox、triage、active、archive | 未实现 |
| Workbench | 统一浏览和受控写入 | 未实现 |
| CLI bootstrap | `pops --help`、`pops --version` | 已实现 |

## 数据契约原则

- Workspace topology、Backlog、Plan、Report、Docs 和 Retrospective 使用独立 versioned schema。
- 不建立覆盖所有 artifact 的通用 schema 或生命周期。
- 跨领域关联使用稳定 logical URI，不把机器绝对路径写入 artifact。
- Plan 使用 `plan/Plan@1` JSON artifact：包含稳定 ID、标题、目标及以局部 key 关联的 Backlog item 草案，并以 `status: draft|approved` 表示生命周期；草案可用 `parent` 和 `depends_on` 引用其他局部 key。批准 Plan 额外包含一次 `approval` 记录（`approved_at` 与 `review_note`）；materialize 后增加 `materialization` 记录（`materialized_at` 与 `mapping`），保存局部 key 到 Backlog ID 的映射。
- `pops plan materialize` 只接受通过 schema/依赖校验且 status 为 `approved` 的 Plan；按 parent/dependency 拓扑创建同一 project 的 epic/task，JSON 输出 mutation receipt。已有完整 mapping 的重试为 `no_op`，不创建或改写条目。
- 派生索引和未来 UI preference 不得成为业务 authority。
- Workspace 是聚合父目录，project 必须是其子路径；workspace 根自身不可登记。
- Workspace 可在非空目录初始化，但不得覆盖已有 manifest 或其他用户内容。
- 登记不强求 git repo，任意目录均可登记；重复登记报错。

## Alpha 产品约束

- 只支持受信任的本地用户和 workspace。
- 优先正确工作流，不承诺完整非法输入处理。
- 不承诺 crash consistency、跨进程事务或对抗性并发安全。
- 不承诺旧版本 schema、现有 Workspace Control 或其他 Project Ops layout 的兼容。
- 真实用户问题出现后再增加 edge-case 行为和回归测试。

## 演进路线

1. ~~Workspace/Catalog 与 Backlog 纵向闭环。~~（基础版已交付：init、显式 project 登记、doctor、backlog store 与 CRUD、状态流转）
2. Plan、Project Docs 和 materialization。（Plan 到 Backlog materialization 已实现。）
3. Report 与 Retrospective 闭环。
4. Local Web Workbench。
5. 安装发行、升级和按真实需求补充 hardening。
