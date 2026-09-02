# JSON 篡改器

SillyTavern 第三方扩展：在 Chat Completion 发往 SillyTavern 内部生成接口之前，按用户预设对最终 JSON 请求进行通用篡改/新增。

## 当前默认预设

- 模型关键词：`kimi`, `moonshotai/kimi-k3`
- 篡改开启
- 查找：`{"role":"assistant","partial":true,"reasoning_content":"*"}`
- 合并修改：`{"reasoning_content":"<thinking>"}`
- 新增关闭

## 支持

- 任意 JSON 查找结构
- `*` 通配符
- 合并字段 / 整个对象替换
- 删除字段路径
- 任意 JSON 新增对象
- 头部第一条 / 头部第 X 条 / 末尾 / 倒数第 X 条 / 第 X 条
- 在匹配结构前 / 后插入
- 多预设保存与切换
- 模型关键词用户自定义
- 成功、未找到、失败均有弹窗

## 手机安装

在 SillyTavern：扩展 → 安装扩展 → 填入 GitHub 仓库 URL。

注意：`manifest.json` 中的 `homePage` 只是占位地址；发布到自己的 GitHub 后请改成真实仓库地址。
