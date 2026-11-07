# dsh-visual-annotator

#dsh-visual-annotator

[![CI](https://github.com/ZhongqiXiao/dsh-visual-annotator/actions/workflows/ci.yml/badge.svg)](https://github.com/ZhongqiXiao/dsh-visual-annotator/actions/workflows/ci.yml) [![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/zhongqixiao/dsh-visual-annotator)

一个 [DeepSeek Harness](https://www.deepseek.com) Desktop 插件：在**真实的 Chrome / Edge 页面**上拾取、标注、评论、截图页面元素，并把元素定位 + 评论 + 截图一并交给 agent —— 让 agent 按照「你实际看到的页面」做前端可视化修改。

类似 ChatGPT / Codex 的内置浏览功能，但驱动的是你自己的浏览器，并深度接入 DSH GUI 的输入框（引用芯片机制）。

## 功能特性

- **元素拾取层**：hover 高亮、点击拾取；拾取层以 Shadow DOM 注入页面，不污染页面样式。
- **元素级捕获**：唯一 CSS selector、页面 URL、视口坐标与尺寸、文本摘录、元素截图。
- **评论标注**：每个拾取元素可附评论，连同定位信息打包成结构化引用。
- **引用芯片**：向 DSH GUI 输入框插入真实 composer chip（`标注 #pN`）；提交时自动展开为完整定位块（selector · URL · 坐标 · 评论 · 截图路径），chip 管线不可用时自动回退纯文本插入；芯片的解析登记表跨面板脚本实例共享，并在本地查不到时回源 `POST /pick`，所以「插入即清空列表」不会让已插入的芯片退化成「该标注已被清除」。
- **浏览器接管**：以专用 profile 启动 Chrome/Edge；同 profile 已有实例则直接**接管**，不重复开窗；同窗口多标签页导航，面板内实时标签列表可切换。
- **一键清空与撤销**：底部「清空」按钮一次清空全部标注（也可在右上角菜单里操作），提示条上的「撤销」可整批恢复；清空只是移出列表，已插入草稿里的芯片仍然可解析。
- **截图管线**：元素截图存本地并作为真实 composer 图片附件插入。

## 环境要求

- Node.js >= 22
- DeepSeek Harness Desktop（web 客户端平台）
- 本机装有 Chrome 或 Edge

## 环境变量

| 变量                                                        | 作用                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `DSH_VISUAL_ANNOTATOR_CHROME` / `DSH_VISUAL_ANNOTATOR_EDGE` | 覆盖浏览器可执行文件路径                             |
| `DSH_VISUAL_ANNOTATOR_WINDOW`                               | 标注窗口尺寸，如 `1440x900`（DIP）；不设则最大化启动 |
| `DSH_VISUAL_ANNOTATOR_HEADLESS`                             | `1` 时无头启动，仅供插件自测                         |

不设 `DSH_VISUAL_ANNOTATOR_WINDOW` 时窗口默认最大化：新 profile 的默认窗口由 Chrome 自己挑，在 4K / 高缩放桌面上会明显偏小，看起来就像整个浏览器被缩放了。环境变量由 host 进程读取，改完需重启 DSH Desktop。

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
4. 为该元素填写评论，点击卡片上的 **插入**（或底部 **全部插入（N 条）**）—— 输入框里出现引用芯片 + 元素截图附件。
5. 插入的同时，这些标注会从列表里移除（底部提示条可 **撤销** 恢复），所以下一轮标注天然从零开始，不用手动逐条清理。
6. 正常提交对话；agent 收到完整定位信息（`visual_annotator_read` 工具可按 `标注 #id` 读取全部详情），随后即可对照页面修改前端代码。

## Agent 侧

插件向 agent 注册 `visual_annotator_read` 工具：传入 `ids` 可按标注 id 精确读取，不传则返回当前全部标注（selector、URL、坐标尺寸、文本摘录、评论、截图路径）。收到 `标注 #pN` 引用时务必调用该工具获取完整上下文。

## License

MIT

## 工程门径

- `npm run verify`：语法检查（node --check）+ ESLint + 单元测试（node --test），提交前必跑；CI 在 PR/push 上强制执行。
- 代码规范：ESLint（host/browser 双环境区分）+ Prettier + `.editorconfig`。
- 面向 AI 代理的协作文档：[`AGENTS.md`](AGENTS.md)（工作约定与硬性约束）、[`docs/API.md`](docs/API.md)（插件 API 契约）。
- 发布：`v*` tag 触发，CI 校验 tag↔package.json 版本一致并跑通门径后自动出 GitHub Release；详见 [`CHANGELOG.md`](CHANGELOG.md)。
