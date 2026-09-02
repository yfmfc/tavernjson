# 小众工具箱 v0.2.9 开发日志

## 基线
本版本以 v0.2.8 为唯一代码基线。除 ZIP 扩展导入模块及本版本说明文档/版本号外，不主动重构、压缩或优化既有代码。

## 本版本目标
补完“从本机 ZIP 导入 TauriTavern 扩展”的完整前置流程，并明确区分：

1. 本机 ZIP 文件获取。
2. ZIP 安全检查与扩展识别。
3. TauriTavern 宿主是否实际提供本机扩展安装桥接。

## ZIP 导入修改

### 1. 增加本地 ZIP 读取与解压组件
新增 `jszip.min.js`，仅用于 ZIP 导入模块。

### 2. GitHub ZIP 结构识别
兼容常见：

`repo-main/manifest.json`

而不是只接受 ZIP 根目录直接存在 `manifest.json`。

### 3. ZIP 安全检查
新增：

- 路径穿越检查。
- 绝对路径检查。
- 多个 manifest.json 检查。
- manifest.js 入口字段检查。
- 解压总大小 200 MB 上限。
- ZIP CRC 检查。

### 4. 安装确认
识别成功后显示：

- 扩展名称。
- 作者。
- 版本。
- 文件数量。
- 解压后大小。

用户主动点击 `确认导入 / 安装` 后才进入安装流程。

### 5. 覆盖/更新语义
宿主存在直接 ZIP 安装能力时，传递 `overwrite: true`，用于覆盖现有同名扩展。

如果宿主只提供 `install_extension`，尝试使用其原生安装命令。

### 6. 当前宿主限制
TauriTavern 当前公开命令列表可以确认存在：

- `install_extension`
- `move_extension`
- `delete_extension`
- `get_extensions`

其中 `install_extension` 的现有实现是扩展安装/更新链路，当前代码并不能仅凭命令名称证明它接受浏览器上传得到的 ZIP bytes。本版本因此不会把“选择 ZIP 成功”谎报为“已经安装成功”。

对于 iOS 普通 `<input type="file">` 得到的 `File`，浏览器侧没有可靠的 Tauri 私有文件系统路径，因此不能在没有宿主文件写入桥接的情况下直接把解压内容写入 `data/extensions/third-party`。

如果 TauriTavern 实际运行环境暴露了 `api.extensions.installZip` / `api.extensions.installFromZip` / `api.installExtensionZip`，本版本会优先调用；如果 `File` 暴露原生路径，也会尝试公开的 `install_extension` invoke。

## 未修改的功能

以下功能在 v0.2.9 中未主动修改其实现逻辑：

- 清理维护扫描器。
- 清理维护执行器。
- 图片转换与 PNG 压缩算法。
- Preset JSON 整理算法。
- 现有 UI 结构和 CSS。

## 文件变更

### 修改
- `index.js`：仅扩展 ZIP 导入相关逻辑。
- `manifest.json`：版本 `0.2.8` → `0.2.9`。
- `README.md`：更新 ZIP 导入功能说明。
- `DEVELOPMENT_LOG.md`：本版本完整变更记录。

### 新增
- `jszip.min.js`：ZIP 解压依赖，仅供 ZIP 导入模块使用。

### 保持不变
- `style.css`：SHA-256 保持 v0.2.8 原值。

## 验证
- JavaScript 语法检查：必须通过。
- ZIP 包完整性检查：必须通过。
- `style.css` 与 v0.2.8 字节级一致：必须通过。
- ZIP 导入模块的修改不会主动改变图片、Preset、清理模块代码。
