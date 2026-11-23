# dsh-annotator

[![CI](https://github.com/ZhongqiXiao/dsh-annotator/actions/workflows/ci.yml/badge.svg)](https://github.com/ZhongqiXiao/dsh-annotator/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/dsh-annotator)](https://www.npmjs.com/package/dsh-annotator) [![node](https://img.shields.io/badge/node-%3E%3D22-339933)](https://www.npmjs.com/package/dsh-annotator)

一个 [DeepSeek Harness](https://www.deepseek.com) Desktop 插件：在**真实的 Chrome / Edge / ego lite 页面**上拾取、标注、评论、截图页面元素，并把元素定位 + 评论 + 截图一并交给 agent —— 让 agent 按照「你实际看到的页面」做前端可视化修改。

类似 ChatGPT / Codex 的内置浏览功能，但驱动的是你自己的浏览器，并深度接入 DSH GUI 的输入框（引用芯片机制）。

## 功能特性

- **元素拾取**：hover 高亮、点击拾取，拾取层不污染页面样式。
- **元素级信息**：唯一 CSS selector、页面 URL、坐标与尺寸、元素原文、元素截图。
- **文案复制与改写**：标到的元素带文字时，卡片和面板都能「复制文字」——原文整段复制（页面侧采集上限 4000 字，超了会标出页面真实字数），不再是 40 字摘录。点「改文案」把它标成文案改动：提示词里会带上完整「原文」，可以再填一句「期望文案」逐字指定新文案，agent 只换元素里的文字，不动结构、样式与属性。参考侧只读，不给这个动作。
- **评论标注**：每个拾取元素可附评论，连同定位信息一起交给 agent。
- **参照模式（改动 ↔ 参照）**：照别人页面改自己页面时，把标注分成左右两栏——左栏「改动区」放要改的元素，右栏「参照区」放只读的样式与结构来源。一条改动可以挂多条参照（1:N），每条参照标明照哪些维度（布局、间距、配色、字号、圆角、交互、文案）；页面不再有角色，同一页可以既有改动又有参照。插入的提示词带一句任务说明与编号「执行要求」：只改带 T 编号的那几处、带 R 编号的只准照不准动、改完逐条自检。
- **引用芯片**：点「插入」后，DSH GUI 输入框里出现 `标注 #pN` 芯片和元素截图附件；提交时自动展开为完整定位信息。芯片管线不可用时自动回退为纯文本插入。
- **浏览器长命复用**：首次「启动」拉起所选浏览器，之后每次都接回同一个实例——不丢登录态，断开连接也不关窗。默认不接管你的日常 Chrome；ego lite 是例外，它优先接管你已经开着的那个 ego lite。
- **一键清空与撤销**：底部「清空」一次清掉全部标注，提示条上的「撤销」可整批恢复。
- **元素截图**：截图存本地，并作为真实图片附件插入输入框；面板里的缩略图点一下就看大图（两栏卡的小图同样可点，`Esc` 或点任意处关闭，看完焦点回到原处）。

## 环境要求

- Node.js >= 22
- DeepSeek Harness Desktop，或用 `dsh web` 起的 Web 客户端（两者都是 web 客户端平台）
- 本机装有 Chrome、Edge 或 [ego lite](https://ego.app) 之一（面板三个都列出来，没装的标「（未安装）」并禁用）

## 安装

同一个包，桌面端与 Web 端都能装。`--profile` 填的不是随意的名字，而是 DeepSeek Harness 两种客户端形态各自对应的 profile：桌面 App 固定用 `desktop`（该 profile 由 Desktop 应用管理），浏览器端固定用 `web`（`dsh web` 等价于 `dsh --profile web`）。`ls ~/.dsh/profiles/` 下可能还会看到 `headless`、`tui` 等其他 profile——那是命令行形态，没有图形面板，装进去也看不见本插件。

### 方式 A：插件市场（图形界面）

**DSH 自带「插件」页**：侧栏 → **插件** → **添加插件**，输入准确包名 `dsh-annotator` → 安装。装完提供「立即启用」，需要重启时会提示。

**社区插件市场**：[dshmarket](https://dshmarket.com)（npm 包 `dshmarket`）收录了本插件，装上之后在市场里搜 `dsh-annotator` 即可安装；插件介绍与收录页见 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/zh/p/ZhongqiXiao/dsh-annotator)。社区市场由第三方维护，收录不代表背书。

### 方式 B：命令行从 npm 安装（推荐）

包发布在 [npm](https://www.npmjs.com/package/dsh-annotator)，要求 Node.js >= 22。

Desktop：

```bash
dsh plugin --profile desktop add dsh-annotator
```

Web：

```bash
dsh plugin --profile web add dsh-annotator
dsh web
```

钉版本写成 `dsh-annotator@0.7.0`，从仓库装写成 `github:zhongqixiao/dsh-annotator`。

### 方式 C：本地目录（开发模式）

把本仓库克隆到任意位置，然后在 `~/.dsh/profiles/desktop/package.json` 中：

```jsonc
{
	"dependencies": {
		"dsh-annotator": "link:C:/path/to/dsh-annotator",
	},
	"dsh": {
		"profile": {
			"bundles": ["dsh-annotator"],
		},
	},
}
```

改的是哪个 profile 就写哪个目录：桌面端 `~/.dsh/profiles/desktop/`，Web 端 `~/.dsh/profiles/web/`。

### 生效与卸载

重启 DSH 生效：Desktop 退出后重新打开；Web 端重新跑一次 `dsh web`。GUI 右侧边栏出现「元素标注」面板即安装成功；后续升级只需更新包再重启，面板会自动加载新版。

卸载与更新走同一套入口：侧栏「插件」页里可停用、更新、卸载，命令行则用 `dsh plugin --profile desktop remove dsh-annotator`（Web 端把 `desktop` 换成 `web`，装进哪个 profile 就从哪个卸）。

## 使用流程

1. 打开 DSH GUI 右侧边栏的 **元素标注** 面板。
2. 输入地址（可以像浏览器地址栏那样只写域名：`gitee.com` 自动补成 `https://gitee.com/`，`localhost:5173` 补成 `http://`，带空格的一句会当成搜索词），按需在左侧选择浏览器（选过一次就记住），点击 **启动** —— 第一次会打开所选浏览器的真实窗口，之后都接回同一个实例；新地址在同一窗口新开标签页。选 ego lite 时会优先接管你已经开着的那个 ego lite（就在那扇窗口里开页）。
3. 启动成功后**自动进入拾取模式**——打开新网页、切标签页也一样，不用再点一次；hover 高亮元素，点击完成拾取。面板里把开关**关掉**之后，本次会话内不会再自动开启（手动再打开即恢复自动）。
4. 为该元素填写评论，点击卡片上的 **插入**（或底部 **全部插入（N 条）**）—— 输入框里出现引用芯片 + 元素截图附件。
5. 插入的同时，这些标注会从列表里移除（底部提示条可 **撤销** 恢复），所以下一轮标注天然从零开始，不用手动逐条清理。
6. 正常提交对话；agent 收到完整定位信息，随后即可对照页面修改前端代码。

### 浏览器里的快捷键与悬浮菜单

调试窗口的每个页面右下角都会注入一个小悬浮层，**不需要安装任何浏览器扩展**：

| 位置 / 操作            | 说明                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| 右下角胶囊「开启标注」 | 拾取模式关闭时的入口，点它或按快捷键开启                                                                |
| ⌥ A / Alt A            | 在页面里直接开关拾取模式（按物理键位判定，不受输入法/大写影响）                                         |
| ⌥ R / Alt+R            | 换落点：下一处标注进「改动」还是「参照」栏（HUD 的两段开关尾部就挂着这枚键帽）                          |
| ⌥ C / Alt+C            | 把全部标注的提示词复制到剪贴板（与面板「复制」进的是同一份内容）                                        |
| HUD 最左侧的六点把手   | 按住拖动 HUD 到顺手的位置（按站点记住）；双击或聚焦后按 `Home` 复位，方向键微调、`Shift` 细调           |
| 控制台「已标注 N 处」  | 拾取模式开启后的悬浮控制台：暂停、撤销、完成·插入                                                       |
| Esc                    | 取消当前这次拾取 / 退出拾取模式                                                                         |
| ⌘/Ctrl + Enter         | 标注卡片内提交（等于点「添加标注」）；键帽按系统显示：macOS 是 `⌘` `⏎`，Windows/Linux 是 `Ctrl` `Enter` |
| Tab                    | 在标注卡片的输入框与按钮之间移动                                                                        |
| 卡片右上「复制」       | 复制该元素的选择器，直接贴进代码或对话                                                                  |

标注卡片贴在目标元素旁边（空间不够时翻到上方，小尖角始终指向元素），卡片打开期间目标元素保持高亮；页面滚动或改变窗口大小时，高亮与卡片一起跟随。

## 浏览器复用

### 一个 profile，多次调试

1. 第一次「启动」用专用 profile 拉起浏览器。
2. 之后点「断开连接」（或关掉面板）只断开连接，**窗口、标签页、登录态都留着**；面板显示「已断开 · 浏览器保留」。
3. 再次「启动」时直接**接回那个实例**，不重开进程，登录态还在；提示「已接回同一个浏览器实例」。
4. 窗口由 DSH 退出时收尾；想立刻关窗，直接点浏览器的关闭按钮或用系统快捷键即可。

新地址一律在同一窗口新开标签页（已开着的同地址则切过去），所以一个实例可以反复调多个页面。

### 标签页条

面板顶部那条「标签页 N」就是浏览器里真实的那一排，**实时同步**：你在浏览器里自己新开、关掉、改标题的标签页都会立即出现/消失。标题是页面自己写的，常常比标签页晚一步出现——没渲染完时先显示 URL，几百毫秒后自动换成标题。点一下某个标签页 = 切到浏览器前台，之后的标注、截图都从这一页取。一行放不下就换行，最多直接显示 10 个；第 11 个起收进右上角「更多 N」弹层。这条列的就是那个窗口里的**全部**页面，三个浏览器同一口径（v0.8 去掉了「空间」这一层）。

### ego lite：接管你开着的那个实例

- **优先接管已运行的实例**：你登录过的站点、书签都还在，不用再登一次。`DSH_VISUAL_ANNOTATOR_ADOPT_RUNNING=0` 可关掉这条，改成自己起一个新实例。
- **关掉新手引导**：全新 profile 的 ego lite 会开一个引导窗口挡住用户，插件启动后自动关掉它。

只有你**显式**设了 `DSH_VISUAL_ANNOTATOR_CDP_URL` 时，插件才会去连一个**别的**外部浏览器；Chrome 与 Edge 不会自动探测常见调试端口，也就不会悄悄接管你的日常 Chrome。

## 环境变量

| 变量                                             | 作用                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `DSH_VISUAL_ANNOTATOR_CHROME` / `_EDGE` / `_EGO` | 覆盖对应浏览器的可执行文件路径                                                                                         |
| `DSH_VISUAL_ANNOTATOR_WINDOW`                    | 标注窗口尺寸，如 `1440x900`（DIP）；不设时 Chrome/Edge 最大化，ego lite 用 `1440x900`（它不认最大化，会缩成 1×1 窗口） |
| `DSH_VISUAL_ANNOTATOR_HEADLESS`                  | `1` 时无头启动，仅供插件自测                                                                                           |
| `DSH_VISUAL_ANNOTATOR_BROWSER_ARGS`              | 额外追加给浏览器的启动开关（逃生口，平时不需要）                                                                       |
| `DSH_VISUAL_ANNOTATOR_SANDBOX_FALLBACK`          | 设 `0` 关掉「沙箱崩溃后自动改用 `--no-sandbox` 重试一次」                                                              |
| `DSH_VISUAL_ANNOTATOR_ADOPT_RUNNING`             | 设 `0` 不接管你已开着的 ego lite，改为自己起一个新实例                                                                 |
| `DSH_VISUAL_ANNOTATOR_AUTO_PICK`                 | 设 `0` 关掉「启动 / 打开网页自动进入标注模式」，改成每次手动开                                                         |
| `DSH_VISUAL_ANNOTATOR_DIR`                       | 覆盖临时文件根目录（默认系统临时目录下的同名目录）                                                                     |
| `DSH_VISUAL_ANNOTATOR_CDP_URL`                   | 可选：改为连接该调试端点上的外部浏览器，如 `127.0.0.1:9222`                                                            |

插件**不往代码仓写文件**：浏览器 profile 与元素截图都在系统临时目录（macOS `$TMPDIR`、Linux `/tmp`、Windows `%TEMP%`）下的 `dsh-visual-annotator/`。面板带上会话 cwd 时，落点进一步细分到 `<项目名>-<cwd 哈希前 8 位>/`：不同项目各用一份 profile 与截图目录，不会串登录态，也不会互相覆盖。系统重启或临时目录清理后会自然消失，无需手动删除。

环境变量由 host 进程读取，改完需重启 DSH Desktop。

## Agent 侧

插件向 agent 注册 `visual_annotator_read` 工具：传入 `ids` 可按标注 id 精确读取，不传则返回当前全部标注（selector、URL、坐标尺寸、文本摘录、评论、截图路径）。收到 `标注 #pN` 引用时务必调用该工具获取完整上下文。

## 参与贡献

欢迎提 Issue 与 Pull Request。开发环境配置、架构说明、代码规范与发版流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)；面向 AI 代理的协作约定见 [`AGENTS.md`](AGENTS.md)。

## License

MIT
