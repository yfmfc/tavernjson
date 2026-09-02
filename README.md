# 小众工具箱 v0.1.0

TauriTavern / SillyTavern 风格的轻量工具扩展原型。

## 当前功能

### 预设 JSON 整理
- 手动选择本地 JSON 文件。
- 以 `prompt_order[].order[]` 作为实际拼装顺序。
- 按 identifier 重排 `prompts[]` 的物理顺序。
- 不修改原文件。
- `prompt_order` 中缺失对应 `prompts[]` 的 ID 不强行修复。
- 不在 `prompt_order` 中的 prompts 保留并放到末尾。
- 支持多个 `character_id` 排序组。
- 导出 `*.organized.json` 新文件。

### 图片格式转换
- PNG / JPEG / WebP。
- 默认 PNG。
- 浏览器本地 Canvas 转换，不上传图片。
- 转换后在结果窗口预览并手动导出。

### 插件 ZIP
- 本地读取 ZIP。
- 检查 `manifest.json`。
- 检查路径穿越 / 绝对路径。
- 第一版不直接写入 TauriTavern 扩展目录，只做安全检查并允许导出原 ZIP。

### 清理维护
目前只提供入口和占位提示，避免在未确认宿主文件 API 前对 TauriTavern 数据目录执行删除或备份操作。

## 安装

把整个目录复制到 TauriTavern 的第三方扩展目录，例如：

`data/default-user/extensions/tauritavern-toolbox/`

然后刷新扩展。

TauriTavern 官方扩展文档说明第三方扩展目录与 SillyTavern 兼容，并通过 `manifest.json` + JS/CSS 入口加载；TauriTavern 运行时可通过 `window.__TAURITAVERN__` 提供宿主 API。

## 安全边界

- 不会直接修改当前正在使用的预设。
- 预设整理只处理用户手动选择的文件副本。
- 不保存 API Key、聊天正文等敏感内容。
- ZIP 不允许 `../`、绝对路径等明显危险路径。
