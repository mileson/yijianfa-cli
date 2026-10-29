# 一键发 CLI 平台指南

部分平台或内容类型对 CLI 输入有超出通用格式的额外要求。每个指南按 `<platform>[-<content-type>]` 命名，放在独立目录中。

## 目录

| 目录 | 适用条件 | 摘要 |
|------|----------|------|
| [`x-article/`](x-article/SKILL.md) | `type: "article"` + `platforms: ["x"]` | HTML 内联 `<img>` 匹配规则、3:4 宽高比自动填充、Draft.js 内容状态 |

## 命名规则

```
cli/skills/
├── README.md              ← 本文件（索引）
├── x-article/             ← X 长文章
│   └── SKILL.md
├── x-dynamic/             ← （示例）X 动态推文
│   └── SKILL.md
├── xiaohongshu-imagetext/ ← （示例）小红书图文笔记
│   └── SKILL.md
└── bilibili-shortvideo/   ← （示例）B站短视频
    └── SKILL.md
```

格式：`<platform>` 对应 `platforms[]` 数组中的值，`<content-type>` 对应 `type` 字段。平台全局规范（不分内容类型）只用平台名。

## SKILL.md 结构约定

每个指南遵循统一结构：

```markdown
---
name: <目录名>
description: 一句话说明
---

# <平台> <内容类型> 发布指南

## 适用条件
  何时需要读本指南（type + platforms 组合）

## 输入要求
  超出通用格式的额外字段、格式、约束

## 扩展自动处理
  扩展内部会自动做哪些事（Agent 无需手动干预）

## 常见错误
  错误现象 → 原因 → 解决

## 参考文件
  相关源码位置
```

## 如何新增

1. 在遇到平台特殊行为时，创建 `cli/skills/<name>/SKILL.md`
2. 更新本 README 的目录表格
3. 更新 `cli/README.md` 中「平台特殊规范」表格
