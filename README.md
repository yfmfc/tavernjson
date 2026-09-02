# JSON 篡改器

SillyTavern 1.18+ 用的通用 Chat Completion 最终请求 JSON 篡改扩展。

## 核心机制

扩展在浏览器端拦截 SillyTavern 发往 `/api/backends/chat-completions/generate` 的最终 POST body，解析最终 JSON 后按当前预设执行篡改/新增，再把修改后的 body 交还给 SillyTavern 原本的 `fetch` 流程。扩展本身不额外发送第二个请求。

## 默认预设

- 模型关键词：`Kimi`
- 篡改：开启
- 查找：完整的 assistant partial reasoning JSON
- 篡改方式：整个对象替换
- 新增：关闭

## 安装

在 SillyTavern 扩展安装界面使用 GitHub 仓库地址：

`https://github.com/yfmfc/json-`

仓库根目录应直接包含 `manifest.json`、`index.js`、`style.css`、`README.md`。
