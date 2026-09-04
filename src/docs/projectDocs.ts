// Project Docs domain: fixed document roles and their built-in templates.

export const PROJECT_DOC_TEMPLATES = [
  {
    path: "README.md",
    content: `# 项目概览

## 项目简介

待填写：说明项目解决的问题、目标用户和当前状态。

## 快速开始

待填写：记录安装、开发和验证命令。
`,
  },
  {
    path: "AGENTS.md",
    content: `# Agent 路由

## 适用范围

待填写：说明本项目的 Agent 工作范围和必须遵守的约束。

## 文档路由

待填写：列出产品、架构和其他长期文档的入口。

## 常用命令与完工验收

待填写：记录常用命令和完成变更前必须执行的检查。
`,
  },
  {
    path: "docs/PRODUCT_SPEC.md",
    content: `# 产品规格

## 产品概述

待填写：说明产品定位、目标和边界。

## 用户与场景

待填写：记录目标用户及核心使用场景。

## 核心功能

待填写：描述当前功能和关键行为。

## 数据契约

待填写：记录对外可见的数据格式与约束。

## 演进路线

待填写：记录已知的后续方向。
`,
  },
  {
    path: "docs/ARCHITECTURE.md",
    content: `# 项目架构

## 架构概览

待填写：说明系统组件及其依赖方向。

## 技术栈

待填写：记录运行时、语言、存储和主要工具。

## 核心流程

待填写：描述主要请求或数据流。

## 约束

待填写：记录架构边界、可靠性和安全约束。
`,
  },
] as const;
