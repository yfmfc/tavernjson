# JSON 篡改器

SillyTavern 1.18+ 用的通用 Chat Completion 最终请求 JSON 篡改扩展。

## 核心机制

扩展在浏览器端拦截 SillyTavern 发往 `/api/backends/chat-completions/generate` 的最终 POST body，解析最终 JSON 后按当前预设执行篡改/新增，再把修改后的 body 交还给 SillyTavern 原本的 `fetch` 流程。扩展本身不额外发送第二个请求。

## 默认预设（v2.1.0）

- 模型关键词：`Kimi`
- 篡改：开启，查找 `reasoning_content` 为**任意值**（通配符 `*`）的 assistant partial 消息，整体替换为 `reasoning_content: "<thinking>"`
- 新增：**开启**，末尾追加 `{role:"assistant", content:"", reasoning_content:"<thinking>", partial:true}`
- 新增前会检查数组末尾是否已经是 `partial:true` 的消息，若是则跳过（防止和篡改规则叠加出现连续两条 assistant 消息）

### v2.1.0 相对 v2.0.0 修的问题

1. **篡改一直不生效**：旧版 `match` 里把 `reasoning_content` 写死成某一次测试时抓到的具体文字（如"先分析一下现在是什么情况。"）。但这段文字是 Kimi/酒馆在"续写只有推理没有正文的消息"这个官方场景下**每次都不同**的动态内容，`deepMatch` 对字符串是精确相等比较，写死的文字下次基本不可能再命中。现在改成通配符 `*`，只要结构对（`role/content/partial` 对得上，`reasoning_content` 有值）就会命中。
2. **新增默认是关的**：导致"全新一轮对话"（数组末尾是 user，还没有任何 assistant partial 消息）时插件什么也不做。现在默认打开插入，专门覆盖这种"从零开始"的场景。
3. **篡改 + 插入同时开会导致请求非法**：如果续写场景下篡改先把消息改成了 partial，插入又不做判断在后面再插一条，会出现两条连续的 assistant 消息。加了 `add.skipIfEndMatches` 字段，插入前检查末尾是否已经是 partial 消息，是则跳过。

## 安装

在 SillyTavern 扩展安装界面使用 GitHub 仓库地址：

`https://github.com/yfmfc/json-`

仓库根目录应直接包含 `manifest.json`、`index.js`、`style.css`、`README.md`。
