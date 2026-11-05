# dsh-visual-annotator

#dsh-visual-annotator

[![CI](https://github.com/ZhongqiXiao/dsh-visual-annotator/actions/workflows/ci.yml/badge.svg)](https://github.com/ZhongqiXiao/dsh-visual-annotator/actions/workflows/ci.yml)

一个 [DeepSeek Harness](https://www.deepseek.com) Desktop 插件：在**真实的 Chrome / Edge 页面**上拾取、标注、评论、截图页面元素，并把元素定位 + 评论 + 截图一并交给 agent —— 让 agent 按照「你实际看到的页面」做前端可视化修改。

类似 ChatGPT / Codex 的内置浏览功能，但驱动的是你自己的浏览器，并深度接入 DSH GUI 的输入框（引用芯片机制）。

## 功能特性

- **元素拾取层**：hover 高亮、点击拾取；拾取层以 Shadow DOM 注入页面，不污染页面样式。
- **元素级捕获**：唯一 CSS selector、页面 URL、视口坐标与尺寸、文本摘录、元素截图。
- **评论标注**：每个拾取元素可附评论，连同定位信息打包成结构化引用。
- **引用芯片**：向 DSH GUI 输入框插入真实 composer chip（`标注 #pN`）；提交时自动展开为完整定位块（selector · URL · 坐标 · 评论 · 截图路径），chip 管线不可用时自动回退纯文本插入。
- **浏览器接管**：以专用 profile 启动 Chrome/Edge；同 profile 已有实例则直接**接管**，不重复开窗；同窗口多标签页导航，面板内实时标签列表可切换。
- **截图管线**：元素截图存本地并作为真实 composer 图片附件插入。

## 环境要求

- Node.js >= 22
- DeepSeek Harness Desktop（web 客户端平台）
- 本机装有 Chrome 或 Edge

## 安装（DeepSeek Harness Desktop）

### 方式 A：从 npm 安装（推荐）

```bash
dsh plugin --profile desktop add dsh-visual-annotator
```

该命令会把包加入 `~/.dsh/profiles/desktop/package.json` 的 `dependencies`，并加入 `dsh.profile.bundles` 启用列表。

### 方式 B：本地目录（开发模式）

把本仓库克隆到任意位置，然后在 `~/.dsh/profiles/desktop/package.json` 中：

```jsonc
{
	"dependencies": {
		"dsh-visual-annotator": "link:C:/path/to/dsh-visual-annotator",
	},
	"dsh": {
		"profile": {
			"bundles": ["dsh-visual-annotator"],
		},
	},
}
```

### 生效

重启 DSH Desktop。GUI 右侧边栏出现「元素标注」面板即安装成功；面板通过版本号自动热刷新（HOST_REV），后续升级只需更新包再重启。

## 使用流程

1. 打开 DSH GUI 右侧边栏的 **元素标注** 面板。
2. 输入地址，点击 **在 Chrome 中调试** —— 打开真实 Chrome 窗口（或接管已有实例）。
3. 开启 **拾取模式**，hover 高亮元素，点击完成拾取。
4. 为该元素填写评论，点击 **插入引用** —— 输入框里出现引用芯片 + 元素截图附件。
5. 正常提交对话；agent 收到完整定位信息（`visual_annotator_read` 工具可按 `标注 #id` 读取全部详情），随后即可对照页面修改前端代码。

## Agent 侧

插件向 agent 注册 `visual_annotator_read` 工具：传入 `ids` 可按标注 id 精确读取，不传则返回当前全部标注（selector、URL、坐标尺寸、文本摘录、评论、截图路径）。收到 `标注 #pN` 引用时务必调用该工具获取完整上下文。

## License

MIT

## 工程门径

- `npm run verify`：语法检查（node --check）+ ESLint + 单元测试（node --test），提交前必跑；CI 在 PR/push 上强制执行。
- 代码规范：ESLint（host/browser 双环境区分）+ Prettier + `.editorconfig`。
- 面向 AI 代理的协作文档：[`AGENTS.md`](AGENTS.md)（工作约定与硬性约束）、[`docs/API.md`](docs/API.md)（插件 API 契约）。
- 发布：`v*` tag 触发，CI 校验 tag↔package.json 版本一致并跑通门径后自动出 GitHub Release；详见 [`CHANGELOG.md`](CHANGELOG.md)。
