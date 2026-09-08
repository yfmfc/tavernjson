# 小众工具箱

TauriTavern 本地维护工具扩展。

## 功能

- 清理维护：扫描旧聊天、角色卡导入后遗留的孤儿世界书、浏览器 Cache Storage，并提供逐类/全局选择与真实删除。
- 扩展导入：从本机选择 ZIP，解析扩展结构、识别扩展身份、检测同名或疑似同名冲突，并提供“仅为我安装 / 为所有用户安装”的安装范围选择。
- 图片转换：从本机选择图片，默认输出 PNG；JPEG/WEBP 提供质量控制，PNG 使用体积优先的重新编码策略。
- Preset JSON 整理：按照 `prompt_order` 中的 `identifier` 顺序重排 `prompts[]`，其余 JSON 数据保持不变。

## API 说明

本扩展优先使用 TauriTavern 公开 Host Contract；需要兼容 SillyTavern 数据行为时使用公开 `/api/*` 兼容接口。

当前 TauriTavern 公开第三方扩展 API 提供 Git URL 安装，不提供本地 ZIP 写入第三方扩展目录的公开接口。因此 ZIP 工具目前负责完整的本地 ZIP 解析、扩展识别和覆盖判断，但在宿主未提供本地安装 API 时不会调用私有 Rust command，也不会显示虚假的“安装成功”。
