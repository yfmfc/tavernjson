# 小众工具箱 Niche Toolbox

面向 SillyTavern 1.18.x（含 TauriTavern）的三合一小工具扩展，纯前端 UI extension，不含 server plugin。

## 安装

**方式一：本地安装（推荐先用这个测试）**

1. 把整个 `niche-toolbox` 文件夹复制到：
   `SillyTavern/data/<你的用户名>/extensions/niche-toolbox/`
   （TauriTavern 下的数据目录布局与官方一致，同样放到对应用户的 `extensions/` 目录下即可）
2. 重启 SillyTavern / TauriTavern
3. 打开扩展面板（魔法棒图标）→ 应该能看到 "小众工具箱 Niche Toolbox" 折叠面板

**方式二：作为第三方扩展导入**

如果你把这个文件夹放到了一个 Git 仓库里，也可以在 扩展 → 安装扩展 里粘贴仓库地址导入，效果一样。

## 功能说明

### 1. 清理维护 · 聊天记录扫描清理
- 设置"超过 N 天未使用"的阈值（默认 15 天，可自行修改并会记住）
- 可选是否包含群组聊天
- 扫描会遍历所有角色 + 所有群组的聊天文件，读取真实的最后消息时间
- 当前正在打开的聊天会被自动排除（防止误删正在用的文件）
- 勾选后点"删除选中"是**真删除**（调用后端删除接口），会有二次确认弹窗

### 2. 图片转换
- 支持批量导入本地图片
- 目标格式：PNG / JPEG / WEBP
- PNG 是无损格式，没有"质量"参数，所以用**限制最大边长**来控制体积
- JPEG / WEBP 提供 0~1 的质量滑块
- 会显示每张图转换前后的体积对比，并可单独下载

### 3. Preset 整理
- 导入本地的 Chat Completion 预设 JSON（就是 Prompt Manager 里用的那种）
- 按 `prompt_order` 中某个 `character_id` 的真实生效顺序，重新排列 `prompts[]` 数组本身的顺序
- 除 `prompts` 外的所有字段（采样参数、各种系统提示词字符串、`prompt_order` 本身等）**原样不动**
- 整理后直接导出一个新的 `xxx_organized.json`，不会覆盖你原来的文件

## 已知需要你在自己环境里验证的点

这几处我是根据官方文档 / DeepWiki 源码摘要推断的字段名，**没有条件在真实服务器上跑一遍**，如果失败请打开浏览器控制台看报错的 HTTP 状态码，再对照你本地版本的
`src/endpoints/chats.js`（或 TauriTavern 对应的 Rust 实现）微调：

1. `chatCleaner.js` 里 `deleteChatItem()` 的请求体字段名（`avatar_url` / `file_name`，群组用的 `id`）
2. `/api/chats/group/get` 返回的到底是纯消息数组还是 `{chat, ...}` 包了一层——如果包了一层，
   `scanIdleChats()` 里取最后一条消息的地方需要相应改成 `messages.chat[...]`
3. 群组聊天没有像角色那样的"轻量元数据"接口，扫描群组时会真正拉取整个聊天内容来读最后一条消息的时间戳，
   如果你的群组聊天特别多/特别长，扫描可能会慢一些

## TauriTavern 兼容性说明

TauriTavern（Darkatse 版本）前端完全沿用 SillyTavern 官方代码，只是把 `fetch`/`jQuery.ajax`
拦截转发到 Rust 后端。这个扩展只用了 `getContext()` 提供的标准 API 和文档化的 REST 接口，
没有依赖任何 server plugin，理论上可以直接在 TauriTavern 里用。下载功能用的是标准
`Blob + <a download>`，正常应该也能在 Tauri 的 WebView 里触发系统保存，如果你那边下载没反应，
大概率是 Tauri 打包时的 CSP / 文件系统权限限制，需要看 TauriTavern 自己的宿主 ABI 文档有没有
提供原生保存接口作为 fallback。
