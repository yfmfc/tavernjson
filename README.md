# 小众工具箱 v0.2.1

TauriTavern 专用移动端辅助扩展。

## 已实现

- 收纳式四功能入口：清理维护、扩展导入、图片转换、Preset 整理。
- Preset JSON：读取 JSON 内已有 `prompt_order` 的 identifier 顺序，只重新排列 `prompts[]` 对象；不修改任何对象字段、ID、`prompt_order` 或其他数据。
- 图片转换：从设备本机选择图片，PNG/JPEG/WEBP 互转，结果以本地文件方式保存。
- 遗留角色世界书扫描：读取 TauriTavern 保留的 SillyTavern 1.18 World Info 接口，并使用前端标准请求头；只提示有 Character Book `originalData` 且当前没有角色主世界书绑定的候选。

## 目前限制

- 本地 ZIP 选择和 ZIP 基础校验已实现，但当前 TauriTavern 公共 Host/API 没有把本地 ZIP 直接安装到 Extension 目录的公开接口，因此本版本不会假装安装成功。
- 聊天 15 天清理、缓存清理、已删除扩展数据清理暂未接入，原因是需要 TauriTavern 的完整历史/文件系统/扩展存储公开能力，不能猜私有目录。
- “修改 TauriTavern 在系统桌面上的 App 图标/名称”已从本插件删除，不通过 Extension 伪造原生 App 身份修改。
