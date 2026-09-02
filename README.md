# 小众工具箱

TauriTavern 实用扩展。

## 功能

- 清理维护：扫描旧聊天、角色卡内嵌 Character Book 形成的遗留世界书、Cache Storage、浏览器存储与可见扩展设置残留。
- 扩展导入：从本机选择 ZIP，读取 manifest.json，识别扩展名与版本，并按同名安装情况给出安装、替换或阻止降级的结果。
- 图片转换：从本机选择图片，转换 PNG、JPEG、WEBP；JPEG/WEBP 提供画质选项，PNG 提供颜色数量与无损选项，并可限制最大尺寸。
- Preset JSON 整理：按 prompt_order 中选定排序组的 identifier 顺序重排 prompts[]，除 prompts 数组对象排列外不修改任何数据。

## 清理规则

角色卡遗留世界书只有在检测到 Character Book 原始数据或工具历史来源记录，并且当前没有角色主世界书、辅助世界书、全局世界书、当前聊天世界书或当前 Persona 世界书引用时，才进入删除候选。

Cache Storage 可以直接清理。LocalStorage、SessionStorage、IndexedDB 只做扫描，不提供批量删除，避免误删酒馆业务数据。TauriTavern 私有临时目录、原生缓存等没有稳定公开第三方扩展契约时，只提示，不猜路径。

## 扩展 ZIP 导入

浏览器文件选择、ZIP 校验、manifest 读取、同名与版本判断均在扩展前端完成。桌面端优先直接使用 Tauri 文件系统把 ZIP 解压到 TauriTavern 数据目录的 third-party 扩展目录；没有原生文件系统能力时，再回退到可用的浏览器目录权限方式。
