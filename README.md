# ProjectOps

ProjectOps 是面向人类开发者和 Coding Agent 的本地 Project Operations 工具。它以可版本控制的
Markdown/JSON 文件为权威数据，计划统一管理项目注册表、Backlog、Plan、Delivery Report、项目文档体系和
Workflow Retrospective。

项目当前处于 Alpha 初始化阶段，以快速交付可运行的纵向工作流为主，不提供生产级安全、兼容性或完整边界保证。

## 快速开始

```bash
npm install
npm run dev -- --help
npm test
npm run typecheck
npm run build
node dist/cli.js --version
```

最终 CLI 名称为 `pops`。初始 npm package 保持 `private`，因为 npm registry 已存在同名的
`projectops` 和 `pops` package；公开发行名将在发布阶段另行决定。

## 当前能力

- 可运行的 TypeScript CLI 入口
- `pops --help`
- `pops --version`
- 最小 happy-path 测试、类型检查和构建

产品范围见 [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)，架构边界见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

