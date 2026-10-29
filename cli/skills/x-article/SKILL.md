---
name: x-article
description: 通过一键发 CLI 发布 X 长文章时的输入规范、图片嵌入规则和自动宽高比处理说明。
---

# X 文章发布指南

## 适用条件

`type: "article"` + `platforms: ["x"]` 时必须遵循本指南。

## 输入要求

### HTML 正文必须包含 `<img>` 标签

X 文章的内联图片**不会**靠 `assets` 数组自动插入。扩展通过匹配 HTML 中 `<img>` 标签的 basename 与 `assets` 中的文件名来定位图片。

**必须**在 `data.content`（HTML）的正确位置插入 `<img>` 标签：

```html
<h2>架构示意</h2>
<img src="/path/to/schema.jpg" alt="架构示意图" />
<p>如上图所示...</p>
```

- `<img>` 的 `src` **basename**（如 `schema.jpg`）必须与 `assets` 中对应素材的文件名完全一致
- 没有 `<img>` 标签 = 没有内联图片，即使 `assets` 中有 `role: "media"` 的文件

### 完整输入示例

```json
{
  "type": "article",
  "platforms": ["x"],
  "data": {
    "title": "文章标题",
    "content": "<h2>正文</h2><p>段落</p><img src=\"/tmp/images/chart.jpg\" alt=\"图表\" /><p>更多内容</p>"
  },
  "assets": [
    { "path": "/tmp/images/cover.jpg", "role": "cover", "type": "image/jpeg" },
    { "path": "/tmp/images/chart.jpg", "role": "media", "type": "image/jpeg" }
  ]
}
```

### 封面图

- 使用 `role: "cover"` 的 asset，不需要在 HTML 中有 `<img>` 标签
- 封面与正文图片独立处理
- 尺寸建议 ≥ 1200px 宽度

### Markdown → HTML 转换注意

从 Markdown 构建输入时：

1. `![alt](path)` 必须转为 `<img src="path" alt="alt" />`
2. 图片路径 basename 应与 `assets[].path` 的 basename 一致
3. 不要丢弃图片标记
4. 清除未转换的 Markdown 符号残留（`**`、`[]()`等）

## 扩展自动处理

以下行为由扩展在上传前自动完成，Agent **无需**手动干预：

| 处理 | 触发条件 | 行为 |
|------|----------|------|
| 3:4 宽高比填充 | 图片宽高比 < 3/4 | 白底居中填充至 3:4，避免 X 预览裁剪 |
| 大图缩放 | 图片 > 5MB | 缩放到 1024×2048 以内 |
| img → blobUrl 替换 | `type: "article"` 且有 media assets | HTML 中 `<img src>` 自动替换为 asset server 的 blobUrl |

> 构建输入时仍建议将高度控制在 ≤ 800px 以获得最佳显示效果。

### 内部匹配流程

```
CLI prepare
  └─ 为每个 asset 启动 asset server → 生成 blobUrl

CLI fill → 扩展 options.js materializeCliTaskData()
  ├─ 构建 nameToBlobUrl Map（key = asset.name）
  └─ 遍历 HTML <img src="..."> → basename 匹配 → 替换为 blobUrl

扩展 platforms/x.js fillArticle()
  └─ 遍历 HTML <img src="blobUrl">
      ├─ fetch → File → padToMinAspectRatio() → uploadImage()
      └─ 写入 Draft.js entity_map → 嵌入文章
```

## 常见错误

| 现象 | 原因 | 解决 |
|------|------|------|
| 图片没有嵌入文章 | HTML 中没有 `<img>` 标签 | 在 `data.content` 正确位置插入 `<img>` |
| 图片没有嵌入文章 | basename 与 asset 文件名不匹配 | 确保 basename 完全一致 |
| `EXECUTION_PARTIAL 0/N` | `data.content` 中没有任何 `<img>` | 检查 Markdown → HTML 是否保留了图片引用 |
| 图片被裁剪 | 宽高比 < 3:4 | 扩展自动处理，无需干预 |

## 参考文件

| 文件 | 关键函数/位置 |
|------|---------------|
| `platforms/x.js` | `fillArticle()`、`padToMinAspectRatio()`、`uploadImage()` |
| `options.js` | `materializeCliTaskData()`、`cliAssetToFileData()` |
| `cli/README.md` | 通用输入格式 |
