# 小众工具箱 v0.1.1

TauriTavern / SillyTavern 前端扩展原型。

## 安装

解压后，把 `tauritavern-toolbox` 整个文件夹放入：

`data/extensions/third-party/tauritavern-toolbox/`

并确保 `manifest.json`、`index.js`、`style.css`、`settings.html` 直接位于这个文件夹里。

刷新 TauriTavern 后，打开「扩展」面板，应看到「小众工具箱」设置入口，点击「打开」即可进入工具箱。

TauriTavern 的官方扩展开发文档确认第三方扩展目录与 SillyTavern 兼容，并使用 `manifest.json` + JS/CSS 方式加载。 

## 当前功能

- 预设 JSON 整理：按 `prompt_order[].order[]` 重排 `prompts[]`，导出新 JSON。
- 图片转换：PNG / JPEG / WebP，转换后预览并导出。
- 插件 ZIP 检查：检查 manifest 和危险路径。
- 清理维护：入口保留，实际数据清理暂不启用。

## 安全

不会自动修改当前正在使用的预设，也不会写回用户导入的原 JSON。
