# dsh-visual-annotator

#dsh-visual-annotator

[![CI](https://github.com/ZhongqiXiao/dsh-visual-annotator/actions/workflows/ci.yml/badge.svg)](https://github.com/ZhongqiXiao/dsh-visual-annotator/actions/workflows/ci.yml) [![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/zhongqixiao/dsh-visual-annotator)

一个 [DeepSeek Harness](https://www.deepseek.com) Desktop 插件：在**真实的 Chrome / Edge / ego lite 页面**上拾取、标注、评论、截图页面元素，并把元素定位 + 评论 + 截图一并交给 agent —— 让 agent 按照「你实际看到的页面」做前端可视化修改。

类似 ChatGPT / Codex 的内置浏览功能，但驱动的是你自己的浏览器，并深度接入 DSH GUI 的输入框（引用芯片机制）。

## 功能特性

- **元素拾取层**：hover 高亮、点击拾取；拾取层以 Shadow DOM 注入页面，不污染页面样式。
- **元素级捕获**：唯一 CSS selector、页面 URL、视口坐标与尺寸、文本摘录、元素截图。
- **评论标注**：每个拾取元素可附评论，连同定位信息打包成结构化引用。
- **引用芯片**：向 DSH GUI 输入框插入真实 composer chip（`标注 #pN`）；提交时自动展开为完整定位块（selector · URL · 坐标 · 评论 · 截图路径），chip 管线不可用时自动回退纯文本插入；芯片的解析登记表跨面板脚本实例共享，并在本地查不到时回源 `POST /pick`，所以「插入即清空列表」不会让已插入的芯片退化成「该标注已被清除」。
- **一个 profile 反复用**：首次启动用专用 profile 拉起 Chrome / Edge / ego lite（面板顶部选浏览器并记住上次选择；已连接时再换一个会关掉旧窗口换成它），之后每次「启动」都按 profile 目录**接回同一个浏览器实例**，不重建 profile、不丢登录态；断开连接也不会关窗。新地址在同一窗口新开标签页，面板内实时标签列表可切换。默认**不会**接管你的日常 Chrome；ego lite 是例外——它优先接管你已经开着的那个 ego lite，并在里面用自己的「agent 空间」干活。
- **一键清空与撤销**：底部「清空」按钮一次清空全部标注，提示条上的「撤销」可整批恢复；清空只是移出列表，已插入草稿里的芯片仍然可解析。
- **截图管线**：元素截图存本地并作为真实 composer 图片附件插入。

## 环境要求

- Node.js >= 22
- DeepSeek Harness Desktop，或用 `dsh web` 起的 Web 客户端（两者都是 web 客户端平台）
- 本机装有 Chrome、Edge 或 [ego lite](https://ego.app) 之一（面板三个都列出来，没装的标「（未安装）」并禁用）

## 环境变量

| 变量                                             | 作用                                                        |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `DSH_VISUAL_ANNOTATOR_CHROME` / `_EDGE` / `_EGO` | 覆盖对应浏览器的可执行文件路径                              |
| `DSH_VISUAL_ANNOTATOR_WINDOW`                    | 标注窗口尺寸，如 `1440x900`（DIP）；不设则最大化启动        |
| `DSH_VISUAL_ANNOTATOR_HEADLESS`                  | `1` 时无头启动，仅供插件自测                                |
| `DSH_VISUAL_ANNOTATOR_BROWSER_ARGS`              | 额外追加给浏览器的启动开关（逃生口，平时不需要）            |
| `DSH_VISUAL_ANNOTATOR_SANDBOX_FALLBACK`          | 设 `0` 关掉「沙箱崩溃后自动改用 `--no-sandbox` 重试一次」   |
| `DSH_VISUAL_ANNOTATOR_ADOPT_RUNNING`             | 设 `0` 不接管你已开着的 ego lite，改为自己起一个新实例      |
| `DSH_VISUAL_ANNOTATOR_DIR`                       | 覆盖临时文件根目录（默认系统临时目录下的同名目录）          |
| `DSH_VISUAL_ANNOTATOR_CDP_URL`                   | 可选：改为连接该调试端点上的外部浏览器，如 `127.0.0.1:9222` |

插件**不往代码仓写文件**：浏览器 profile 与元素截图都在系统临时目录（macOS `$TMPDIR`、Linux `/tmp`、Windows `%TEMP%`）下的 `dsh-visual-annotator/`。面板带上会话 cwd 时，落点进一步细分到 `<项目名>-<cwd 哈希前 8 位>/`：不同项目各用一份 profile 与 `shots/`，不会串登录态，也不会互相覆盖 `p1.png`；同一项目重复打开仍能接管已开窗口。系统重启或临时目录清理后会自然消失，无需手动删除。

### 一个 profile，多次调试

插件的浏览器窗口是**长命**的，profile 只建一次：

1. 第一次「启动」用专用 profile（临时目录里的 `profile-<browser>/`）拉起浏览器，并把调试端口写进 profile 目录的 `DevToolsActivePort`。
2. 之后点「断开连接」（或关掉面板）只断开 socket，**窗口、标签页、profile 都留着**；面板显示「已断开 · 浏览器保留」。
3. 再次「启动」时按同一份 profile 的 `DevToolsActivePort` 直接**接回那个实例**，不 spawn 新进程、不重建 profile，登录态还在；提示「已接回同一个浏览器实例」。
4. 右上角「更多」里只有一项 **断开连接**：面板不再提供「关闭浏览器」，窗口由 DSH 退出时收尾（host 卸载会 `/close { terminate: true }`，`Browser.close` 关窗，profile 仍留在临时目录，下次打开接着用）；想立刻关窗，直接点浏览器的关闭按钮或用系统快捷键即可。

新地址一律在同一窗口新开标签页（已开着的同地址则切过去），所以一个实例可以反复调多个页面。

### 标签页条

面板顶部那条「标签页 N」就是浏览器里真实的那一排，**实时同步**：

- 你在浏览器窗口里自己新开、关掉、改标题的标签页，会随着 CDP 的 `Target` 事件立即出现/消失，不用重启插件（早先只列插件自己开过的页，所以和窗口对不上）。
- 标题是页面自己写的，常常比标签页晚一步出现：面板每秒核对一次真实的 `Target.getTargets`，等你看到 URL 时说明这页还没渲染完，几百毫秒后会自动换成标题，不会一直停在 URL 上。
- 点一下某个标签页 = 把它切到浏览器前台，并把「当前页」设为它；之后的标注、截图都从这一页取，输入框旁边的地址也会跟着变。
- **平铺而不是横向滚动**：一行放不下就换行，最多直接显示 10 个；第 11 个起收进右上角「更多 N」弹层，点开是整行列表，切换后弹层自动收起。
- 选 ego lite 时这条只列 **agent 空间**里的页面，标题旁有「仅 agent 空间」提示；Chrome / Edge 用的是插件专属 profile，列的是整个窗口。

### 调试空间（独立 cookie，仅 ego lite）

**只有选 ego lite 时面板才出现「空间」一栏**：Chrome / Edge 用的是插件专属 profile，本来就是一整块干净环境，再加一层空间只会让面板更复杂；ego lite 则会和你自己那一屏共存，插件需要一个自己的空间才不抢你的窗口。

面板「空间」一栏可以在**同一个窗口**里另开一个空间，用来隔离登录态：

- 空间就是一份独立的 Chromium **BrowserContext**（与 ego lite 的 task space 同一个原语，`Target.createBrowserContext`），不是另起进程；cookie、localStorage、sessionStorage 与标签页都互不可见。
- 「＋」新建并切过去（重名自动编号成「空间 2」「空间 3」），下拉切换，「×」销毁当前空间（连带它的页面与 cookie，回到默认空间）。
- 「标签页」条只列当前空间的页面，另一个空间开着的页面不会串进来；切换空间时面板沿用输入框里的地址（没输入就沿用当前页）。
- 想登两个账号、或把「调试用账号」和日常登录态隔开时，开一个空间即可，不用再准备第二份 profile。
- 空间的 id 与名字会按「项目 × 浏览器」记在临时目录的 `spaces-<浏览器>.json` 里：断开后重新接回同一个实例，哪个空间叫「agent 空间」、切到哪一屏都还是原样，不会把旧空间当成陌生空间改名、再新建一个空的。

### ego lite：接管你开着的那个实例

ego lite 是「浏览器 + agent 空间」一体的，插件针对它做了三件事：

- **优先接管已运行的实例**：ego lite 会在 `127.0.0.1` 上开一个标准 CDP 端口（随机分配、没有端口文件），插件用 `pgrep` 找到 ego 主进程、再用 `lsof` 的整表输出拿到它的监听端口，像外部浏览器一样接管——你登录过的站点、书签都还在，不用再登一次。`DSH_VISUAL_ANNOTATOR_ADOPT_RUNNING=0` 可关掉这条，改成自己起一个新实例。
- **在「agent 空间」里干活**：接管（或新起）之后，插件会建/复用一个名为 `agent 空间` 的 BrowserContext 并切过去，于是它自己的标签页、cookie 与用户当前那一屏互不打扰；用户切回自己的空间，插件继续在 `agent 空间` 里工作。空间名被占用时自动编号成「空间 2」。
- **关掉新手引导**：全新 profile 的 ego lite 会开一个 `chrome://onboarding/` 窗口挡住用户，插件启动后直接 `Target.closeTarget` 关掉它，浏览器进程与页面都不受影响。

只有你**显式**设了 `DSH_VISUAL_ANNOTATOR_CDP_URL`（比如远程调试或非惯例端口）时，插件才会去连一个**别的**外部浏览器；Chrome 与 Edge 不自动探测 9222 之类的常见端口，也就不会悄悄接管你的日常 Chrome。外部窗口的关闭项是「断开连接（外部浏览器保留）」，插件不会去关它。

想手动给浏览器开调试端口时注意：Chrome 136 起不允许在默认用户目录上开调试端口，需要单独一份用户目录（登录态跟着这份目录走）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$TMPDIR/chrome-debug"
```

不设 `DSH_VISUAL_ANNOTATOR_WINDOW` 时窗口默认最大化：新 profile 的默认窗口由 Chrome 自己挑，在 4K / 高缩放桌面上会明显偏小，看起来就像整个浏览器被缩放了。环境变量由 host 进程读取，改完需重启 DSH Desktop。

## 安装

同一个包，桌面端与 Web 端都能装，区别只在装进哪个 profile：Desktop 用 `--profile desktop`，Web 用 `--profile web`（`dsh web` 等价于 `dsh --profile web`）。

### 方式 A：插件市场（图形界面）

**DSH 自带「插件」页**：侧栏 → **插件** → **添加插件**，输入准确包名 `dsh-visual-annotator` → 安装。Host 会先读出这个名字指向哪个包（注册表包走 `pnpm view`）再装，装完提供「立即启用」，需要重启时会提示。

**社区插件市场**：装了 [DSH Plugin Hub](https://dsh-plugin.org)（npm 包 `dsh-plugin`）或 [dshmarket](https://dshmarket.com)（npm 包 `dshmarket`）之后，直接在市场里搜 `dsh-visual-annotator` 安装。DSH Plugin Hub 的[插件页](https://dsh-plugin.org/plugins/zhongqixiao/dsh-visual-annotator)上也有「复制安装命令」按钮。社区市场由第三方维护，收录不代表背书。

这两个入口做的事和下面的命令行一样：往 profile 的 `package.json` 写依赖、把包加进 `dsh.profile.bundles` 启用列表。

### 方式 B：命令行从 npm 安装（推荐）

包发布在 [npm](https://www.npmjs.com/package/dsh-visual-annotator)，当前版本 `0.5.0`，要求 Node.js >= 22。

Desktop：

```bash
dsh plugin --profile desktop add dsh-visual-annotator
```

Web：

```bash
dsh plugin --profile web add dsh-visual-annotator
dsh web
```

`dsh plugin` 把你给的参数转发给 profile 目录里的 pnpm，所以 pnpm 的写法都能用：钉版本写成 `dsh-visual-annotator@0.5.0`，从仓库装写成 `github:zhongqixiao/dsh-visual-annotator`。该命令会把包加入 `~/.dsh/profiles/<profile>/package.json` 的 `dependencies`，并加入 `dsh.profile.bundles` 启用列表。

### 方式 C：本地目录（开发模式）

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

改的是哪个 profile 就写哪个目录：桌面端 `~/.dsh/profiles/desktop/`，Web 端 `~/.dsh/profiles/web/`。

### 生效

重启 DSH：Desktop 退出后重新打开；Web 端重新跑一次 `dsh web`（`dsh plugin` 改的是启动时读的 profile，不会热加载已启动的进程）。GUI 右侧边栏出现「元素标注」面板即安装成功；面板通过版本号自动热刷新（HOST_REV），后续升级只需更新包再重启。

卸载与更新走同一套入口：侧栏「插件」页里可停用、更新、卸载，命令行则用 `dsh plugin --profile desktop remove dsh-visual-annotator`。

## 使用流程

1. 打开 DSH GUI 右侧边栏的 **元素标注** 面板。
2. 输入地址（可以像浏览器地址栏那样只写域名：`gitee.com` 自动补成 `https://gitee.com/`，`localhost:5173` 补成 `http://`，带空格的一句会当成搜索词），按需在左侧选择浏览器（Chrome / Edge / ego lite 三个都列出，没装的标「（未安装）」并禁用；选过一次就记住），点击 **启动** —— 第一次会打开所选浏览器的真实窗口，之后都接回同一个实例；新地址在同一窗口新开标签页。选 ego lite 时会优先接管你已经开着的那个 ego lite，并在其中切到「agent 空间」。
3. 开启 **拾取模式**，hover 高亮元素，点击完成拾取。
4. 为该元素填写评论，点击卡片上的 **插入**（或底部 **全部插入（N 条）**）—— 输入框里出现引用芯片 + 元素截图附件。
5. 插入的同时，这些标注会从列表里移除（底部提示条可 **撤销** 恢复），所以下一轮标注天然从零开始，不用手动逐条清理。
6. 正常提交对话；agent 收到完整定位信息（`visual_annotator_read` 工具可按 `标注 #id` 读取全部详情），随后即可对照页面修改前端代码。

### 浏览器里的快捷键与悬浮菜单

调试窗口的每个页面右下角都会注入一个小悬浮层，**不需要安装任何浏览器扩展**：

| 位置 / 操作            | 说明                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| 右下角胶囊「开启标注」 | 拾取模式关闭时的入口，点它或按快捷键开启                                                                |
| ⌥ A / Alt A            | 在页面里直接开关拾取模式（按物理键位判定，不受输入法/大写影响）                                         |
| 控制台「已标注 N 处」  | 拾取模式开启后的悬浮控制台：暂停、撤销、完成·插入                                                       |
| Esc                    | 取消当前这次拾取 / 退出拾取模式                                                                         |
| ⌘/Ctrl + Enter         | 标注卡片内提交（等于点「添加标注」）；键帽按系统显示：macOS 是 `⌘` `⏎`，Windows/Linux 是 `Ctrl` `Enter` |
| Tab                    | 在标注卡片的输入框与按钮之间移动                                                                        |
| 卡片右上「复制」       | 复制该元素的选择器，直接贴进代码或对话                                                                  |

标注卡片贴在目标元素旁边（空间不够时翻到上方，小尖角始终指向元素），卡片打开期间目标元素保持高亮；页面滚动或改变窗口大小时，高亮与卡片一起跟随，不会停在已经无关的位置上。卡片底部的提交按钮会把快捷键拆成两枚独立键帽（`⌘` `⏎`，Windows/Linux 为 `Ctrl` `Enter`），左侧的 `Esc` 键帽提示取消，按钮高度按触控可达尺寸（42px 以上）留足。

悬浮层由 CDP 注入（`Page.addScriptToEvaluateOnNewDocument` + `Runtime.addBinding`），因此不受页面 CSP 影响，也不会出现在普通浏览里。

## Agent 侧

插件向 agent 注册 `visual_annotator_read` 工具：传入 `ids` 可按标注 id 精确读取，不传则返回当前全部标注（selector、URL、坐标尺寸、文本摘录、评论、截图路径）。收到 `标注 #pN` 引用时务必调用该工具获取完整上下文。

## License

MIT

## 工程门径

- `npm run verify`：语法检查（node --check）+ ESLint + 单元测试（node --test），提交前必跑；CI 在 PR/push 上强制执行。
- `npm run test:e2e`：**真浏览器**的端到端用例（默认不在 `npm test` 里跑）。对每个装了的浏览器各跑一遍「启动 → 拾取层注入 → 同址不重复开标签 → 新址开新标签 → 断开后接回同一实例（页面内标记仍在）」「调试空间 cookie 隔离 + 拾取层注入 + 关闭回默认」，装了 ego lite 再跑「接管已运行的实例：不 spawn 新进程、断开不杀对方的浏览器」，装了 ≥2 个再跑「换浏览器：旧进程退出、新进程起来」。没装的浏览器自动跳过（本机无 Edge 就只跑 Chrome / ego lite），所以装了 Edge 的机器天然覆盖到它。用例默认带 `ADOPT_RUNNING=0`，不会跑到你日常开着的 ego 里开会话。
  用例用无头 + 临时 profile，不需要任何额外开关：宿主自带的沙箱会拦住 Chrome 自己的 sandbox（renderer 立刻 `SIGTRAP`、CDP socket 在握手后关闭，日志里的 `chrome connection is closed`），插件识别到「自己起的实例刚死」后会带 `--no-sandbox` 自动重试一次，快照里的 `sandboxFallback` 会变成 `true`。这条回退只作用于**自己 spawn** 的进程，接回的外部窗口不受影响；不想要它可设 `DSH_VISUAL_ANNOTATOR_SANDBOX_FALLBACK=0`。
- 代码规范：ESLint（host/browser 双环境区分）+ Prettier + `.editorconfig`。
- 面向 AI 代理的协作文档：[`AGENTS.md`](AGENTS.md)（工作约定与硬性约束）、[`docs/API.md`](docs/API.md)（插件 API 契约）。
- 发布：`v*` tag 触发，CI 校验 tag↔package.json 版本一致并跑通门径后自动完成 GitHub Release + npm 发布 + 插件市场 tarball 更新；发版流程详见 [`docs/RELEASE.md`](docs/RELEASE.md)，变更记录见 [`CHANGELOG.md`](CHANGELOG.md)。
