# 小众工具箱

TauriTavern 专用前端扩展初版。

## 当前已实现

- Preset JSON 整理：按 `prompt_order[].order[].identifier` 重新排列 `prompts[]`；只改变数组中对象的排列，不改对象内容、不改 `prompt_order` 或其他字段；未被引用的 prompt 保持原相对顺序并放在末尾。
- 图片转换：PNG / JPEG / WEBP 互转，浏览器端 Canvas 处理后直接保存，不依赖第三方网站。
- 遗留角色世界书扫描：读取 `/api/worldinfo/list` + `/api/worldinfo/get`，识别具有 `originalData.entries` 的角色卡 Character Book 来源世界书，并排除当前仍被角色 `data.extensions.world` 引用的世界书；结果仅作为清理候选，不自动判断为垃圾。
- 清理选中的遗留世界书：使用 TauriTavern/SillyTavern 兼容的 `/api/worldinfo/delete`。

## 暂未实现

- 15 天未使用聊天扫描：待接入 TauriTavern 完整聊天索引 API。
- 缓存安全清理：待接入明确的 TauriTavern Host API，避免猜测宿主目录。
- 已删除扩展数据：待接入宿主扩展/存储枚举能力。
- 本项目的“个性化”目前只保存并修改扩展自身入口显示的名称/图标文字；不声称可以通过普通 Extension 改变 iOS 原生 App Bundle 图标。

## 世界书依据

SillyTavern 1.18.0 的 `convertCharacterBook()` 会生成 `{ entries: {}, originalData: characterBook }`；导入角色卡嵌入 World/Lorebook 时调用该转换并保存 World Info，随后把世界书名称作为角色的 `data.extensions.world` 链接回角色。World Info 保存接口把传入的整个 data JSON 原样写入世界书文件。因此 `originalData` 可以作为“角色卡 Character Book 来源”的强证据，而角色 `extensions.world` 用于排除仍有角色主绑定的世界书。
