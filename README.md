# 小众工具箱

TauriTavern / SillyTavern 1.18 compatible offline third-party extension.

## 功能

- 🧹 清理维护：World Info、角色/群组聊天记录、Cache Storage、LocalStorage、SessionStorage、IndexedDB，以及可探测到的 TauriTavern data 下临时/缓存目录与宿主 app cache / temp 目录。
- 📦 本地扩展导入：本机 ZIP，支持根目录或任意一层顶层目录的 `manifest.json`；按 manifest identity 匹配现有扩展；新安装、升级、降级、同版本重装；临时目录写入、备份旧目录、完整替换、安装后验证和刷新。
- 🖼️ 图片格式转换：PNG/JPEG/WebP，JPEG/WebP 质量 55–95，最大边原尺寸/4096/2560/1920/1280，PNG 重编码与 256/128/64 色快速量化。
- 📋 Preset JSON 整理：按 `prompt_order` 的 identifier 重排 `prompts`，只改变 `prompts` 数组排列，保留其他字段和未出现在排序表中的提示词。

## 安装

全局：
`data/extensions/third-party/xiaozhong-toolbox/`

本地用户：
`data/default-user/extensions/xiaozhong-toolbox/`

复制整个插件目录后刷新 TauriTavern。

## 文件系统说明

插件优先使用 TauriTavern host / Tauri fs 的本地 invoke 能力。ZIP 安装如果当前打包版本没有向扩展暴露本地文件读写命令，会要求手动选择 TauriTavern `data` 目录；若仍无读写能力，则报告明确错误而不伪造安装成功。

## 资料依据

实现基于 TauriTavern 当前公开的 Extension Development / Frontend Host Contract，以及 SillyTavern 1.18.x 的 UI Extension、World Info、Chat 和 Prompt Manager 数据约定。
