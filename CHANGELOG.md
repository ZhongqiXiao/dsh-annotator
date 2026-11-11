# 更新日志

本文件记录 dsh-annotator 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.5.5] - 2026-11-11

### Added

- **启动浏览器 / 打开网页后自动进入标注模式**：启动成功即进入 pick；之后打开新网页、切标签页、切空间同样自动进入，面板开关跟着显示为开，不用再点一次。判定逻辑下沉到 `lib/shared/auto-pick.js`（`decideAutoPick` / `nextUserTurnedOff`），`session.js` 只在成功路径上做薄委托。
- **用户关掉要粘住**：面板里关闭开关后，本次浏览器会话内不再自动开启；再手动打开则恢复（下一次打开网页照常自动进 pick）。新建空间、切空间不会悄悄把它打开。
- **逃生阀**：`DSH_VISUAL_ANNOTATOR_AUTO_PICK=0` 关掉全部自动行为（只关自动，手动开关仍然可用）。

### Fixed

- **自动进入 pick 后，注入层的端到端用例仍断言折叠胶囊可见**：启动即 pick 时页面里显示的是控制台 `.cluster`、折叠胶囊 `.pill` 是隐藏的，Chrome/Edge 各一条用例因此判红（Browser e2e 已去掉 `continue-on-error`，红就是真红）。断言改为「HUD 可见 + 当前模式该显示的那一个可见」，并新增一条端到端用例覆盖本次功能的三个行为：启动即 pick、用户关掉后打开网页仍粘住、手动再打开后恢复自动。

## [0.5.4] - 2026-11-11

### Changed

- **插件包名改为 `dsh-annotator`**：插件市场与 npm 安装名同步更新（`dsh plugin --profile desktop add dsh-annotator`）。本地开发打包（`npm pack`）产物名与 `cordis.patch.yml` 的 Loader id/name 一并改齐，从仓库装（`github:zhongqixiao/dsh-visual-annotator`）的用法不变。GitHub 仓库名、市场收录页 slug、运行时内部标识（路由 `/api/visual-annotator/*`、agent 工具 `visual_annotator_read`、临时目录名）不变。发版 tarball 以 `dsh-annotator.tgz` 为主资产，另附旧名 `dsh-visual-annotator.tgz` 兼容副本，官方市场旧链接继续可用。

## [0.5.3] - 2026-11-10

### Fixed

- **点「添加标注」或 Ctrl / ⌘ + Enter 时页面闪一屏**：截图一直带着 `clip`，而 Chrome 为了截这一小块会把合成面换成 clip 尺寸重渲染一帧再还原——用 `Page.startScreencast` 抓合成帧可以直接看到：点完之后 +195ms 多出来的一帧尺寸正好等于 clip（228×68），与静止帧差异 70.6%，+255ms 才回到原尺寸且像素与静止帧完全一致，肉眼就是闪一下。现在不再带 clip、也不再撑视口，只截当前视口（`captureBeyondViewport:false`），元素区域改在 Node 侧用新增的 `lib/shared/png.js` 裁出来（自带最小 PNG 解码/编码，没引第三方图像库）。同一段 screencast 复测：截图多推的那一帧是 380×208 且与静止帧**逐像素相同（changed 0）**，无可见变化。HiDPI 下按「截图宽 ÷ 视口宽」换算裁剪框（`--force-device-scale-factor=2` 实测 228×68 CSS 像素裁出 456×114 设备像素，边界按视口夹紧）。
- **0.5.2 的 host 侧判重没随包发出**：`lib/shared/pick-dedupe.js` 与 `lib/session.js` 里的调用漏在提交之外，v0.5.2 实际只有面板侧的插入闸门与单飞锁。现已补齐：1.5 秒内 url / selector / seq / 矩形 / 备注完全相同的 pick 直接丢弃，一次提交投递多次也只入列一条。

## [0.5.2] - 2026-11-10

### Fixed

- **点「插入」或 Ctrl / ⌘ + Enter 会插入两三次一模一样的标注**（Windows 上更常见）：GUI 里同一个面板可能同时挂着多份实例（热重载、同一 slot 被注册两次、后台常驻的旧模块），每份都在 `window` 上注册同一套快捷键监听，一次按键被 N 份各插一遍。现在加了挂在 `window` 上的插入闸门 `__DSH_VP_INSERT_GATE__`（各模块副本共享）：快捷键按**事件对象身份**认领，同一次按键不管几个监听器只放行一次；页面 HUD 回传的 `pendingConsume` 按 token 认领，失败才退回以免真的丢掉一次插入；「插入」「全部插入」两个按钮走单飞锁，插入期间重复点击忽略。host 侧 `_recordPick` 再兜一层：1.5 秒内 url / selector / seq / 矩形 / 备注完全相同的 pick 直接丢弃，重复的 binding 投递不会在列表里堆三条。面板构建升到 v28。
- **点「插入」瞬间卡片闪一下**：`commit()` 原来先清空 textarea 的高度再关卡片——多行备注的卡片会先缩回单行、下一帧才消失，看起来就是抖一下。现在改为先 `closeCard()`（`display:none`）再清内容与高度，卡片一次性消失。注入层 REV 升到 12。

## [0.5.1] - 2026-11-10

### Changed

- **安装说明补齐 Desktop / Web 与两条安装途径**：README 的安装一节重写为三条路径——插件市场（DSH 自带「插件」页输入包名，或 DSH Plugin Hub / dshmarket 里搜）、命令行从 npm 安装（`dsh plugin --profile desktop|web add dsh-visual-annotator`，附 Web 端 `dsh web`）、本地目录开发模式（`link:` + `dsh.profile.bundles`）；并写清生效条件（重启 Desktop / 重跑 `dsh web`）与卸载入口。

### Fixed

- **标注框跑到左上角、盖住刚点的元素（Windows Edge 尤甚）**：注入层的 host、高亮框与标注卡都是 `position:fixed`，一旦页面里有祖先建了包含块（`transform` / `filter` / `will-change` / `contain`，React 壳与各种动画库很常见），fixed 子元素就相对那一层而不是视口定位，host 自己的矩形随滚动偏成 `-scrollY`，于是把 `getBoundingClientRect()` 的视口坐标直接写进 `left/top` 的框整体错位。现在新增 `hostOrigin()` 与 `place()`，高亮框、标签、卡片所有坐标都先减去 host 原点（实测：祖先带 `translateZ(0)`、scrollY=200 时 host 矩形是 `{x:0,y:-200}`，修复前框偏 -200，修复后精确落在目标上）。注入层 REV 升到 11。
- **卡片在目标贴顶或本身很高时跳到视口左上角**：`positionCard` 重写——先把卡片夹进视口再摆，上下都放不下时按鼠标点的反方向选边，尖角朝向由实际几何决定（与目标水平方向都不重叠就干脆不画尖角），尺寸改用 `offsetWidth/offsetHeight` 避开入场动画 `scale(.985)` 量小；卡片打开时不再把页面滚走（恢复焦点带 `preventScroll`）。
- **点「添加标注」或 Ctrl / ⌘ + Enter 插入时整页抖一下**：截图不再用 `captureBeyondViewport` ——它会把渲染视口临时撑成整页再还原，页面收到一次 `resize` 并整页重排。现在先用 `Page.getLayoutMetrics` 把截图区域夹进当前可见区，只有元素完全在视口外时才退回整页截图（实测六个场景——普通/带 transform、小目标/角落元素/超高目标——提交后 `resize` 计数与滚动位移都是 0）。
- **浏览器选择器一改就自己开浏览器**：下拉框的 `onChange` 现在只记住选择、不发 `/launch`；已连接且选中的不是当前浏览器时，右侧按钮变成「切换到 Edge」，点下去才会关掉旧窗口起新实例（标注记录保留）。

## [0.5.0] - 2026-11-10

### Added

- **一个 profile，跨多次调试复用**：每个（项目 × 浏览器）只建一份 profile，首次 `/launch` spawn 浏览器后，后续 `/launch` 读 profile 目录里的 `DevToolsActivePort` 接回同一个实例，不重开进程、不重建 profile、不丢登录态；新地址在同一窗口新开标签页。`/close` 缺省只断开 socket（`/state.windowKept` 反映窗口保留），`/close { terminate: true }` 才 `Browser.close`；面板对应拆成「断开连接（保留浏览器）」与「关闭浏览器」两项，并新增「已接回同一个浏览器实例」提示（`/state.resumed`）。
- **显式连接外部浏览器**：仅在设置 `DSH_VISUAL_ANNOTATOR_CDP_URL` 时连接该端点上的浏览器，默认不探测 9222 等常见端口——避免接管用户日常 Chrome。归一化与解析下沉为 `lib/shared/cdp-endpoint.js` 纯函数并补单测。

- **支持 ego lite 与 Edge 启动**：浏览器清单从「写死 chrome/edge」改为 `lib/shared/browsers.js` 注册表（`chrome` / `edge` / `ego`），`/launch` 不点名时用第一个装了的浏览器，找不到时按注册表给出对应的 `DSH_VISUAL_ANNOTATOR_*` 提示；面板新增浏览器选择器（只列装了的、记住上次选择），host 通过 `/state` 的 `browserOrder` / `browserLabels` / `browserDefault` 下发注册表，两半不会各写一份 id。

- **真浏览器的端到端用例**：新增 `test/e2e-browsers.test.mjs`（默认 skip，`npm run test:e2e` 才跑），对每个已安装的浏览器各跑一遍真实使用顺序——启动 → 拾取层真注入 → 同址不重复开标签 → 新址开新标签 → 断开（保留窗口）后 `/launch` 接回同一实例且页面内标记仍在 → 关闭浏览器；再跑「调试空间与默认空间 cookie 互不可见、新空间里拾取层同样注入、关闭空间回默认空间」；装了 ≥2 个浏览器再跑「换浏览器：旧进程退出、新进程起来」。本机实测 Chrome 156 + ego lite 0.6.2.9 共 6 例全绿（Edge 未安装则自动跳过）。此前 `test/` 只有纯函数单测，启动/复用/切换/空间这些只有真浏览器能证明的行为没有任何看护。
- **`DSH_VISUAL_ANNOTATOR_BROWSER_ARGS`**：给 spawn 的浏览器追加命令行开关（只接受 `--flag` 形式，裸词会被 Chromium 当成要打开的地址故丢弃），解析下沉为 `parseExtraArgs` 纯函数并补单测。定位是逃生口：常见的沙箱崩溃已由下面的自动回退处理，不必自己传 `--no-sandbox`。
- **ego lite 三件事：复用已运行实例 / 独立 agent 空间 / 关掉新手引导**：① 用户自己开着的 ego lite 也会在 `127.0.0.1` 上监听标准 CDP 端口（随机分配、无端口文件），插件用 `pgrep -fl` 找主进程、`lsof -nP -F -iTCP -sTCP:LISTEN` 整表取端口（宿主沙箱里 `ps` 与 `lsof -p` 会被拒），像外部浏览器一样接管，登录态原样保留，`/state.reused` / `resumed` 为 true 且不持有进程；`DSH_VISUAL_ANNOTATOR_ADOPT_RUNNING=0` 可关掉。② 接管或新起之后建/复用一个名为 `agent 空间` 的 BrowserContext 并切过去，插件的标签页与 cookie 同用户当前那一屏互不打扰（重名自动编号）。③ 全新 profile 会开 `chrome://onboarding/` 窗口挡住用户，启动后直接 `Target.closeTarget` 关掉它。识别与解析下沉为 `lib/shared/ego.js` 纯函数并补单测（`test/ego.test.mjs`）。
- **选择器列出未安装的浏览器**：面板此前只列装了的浏览器，这台机器没装 Edge 时选择器里根本没有 Edge，看着像「不支持 Edge」。现在三个浏览器都列出来，未安装的标「（未安装）」并禁用（`browserChoices` 纯函数），macOS 候选路径补 `~/Applications/Microsoft Edge.app`。
- **调试空间（独立 cookie 的 BrowserContext）**：新增 `/space` 路由与面板「空间」一行，可在同一窗口里新建/切换/关闭调试空间。空间就是独立的 Chromium BrowserContext（与 ego lite 的 task space 同一原语），cookie 与 localStorage 隔离、标签页互不串；命名与标签归属下沉为 `lib/shared/spaces.js` 纯函数并补单测。实测（ego lite 0.6.2.9）：默认空间写入 `scope=default` 后，新空间 `document.cookie` 为空，切回默认空间 cookie 仍在。
- **标签条与浏览器真实标签页实时同步**：host 在 `_seedTabs()` 里打开 `Target.setDiscoverTargets`，此前浏览器只把它主动 attach 过的页面报给插件，用户在窗口里自己按 ⌘T 新开、关掉、改标题的标签页要等到下次启动才出现，面板那一排和浏览器上那一排对不上；现在 `Target.targetCreated` / `targetInfoChanged` 一到就进列或退列，当前页地址与标题也随事件刷新。标签行标题改成「标签页 N」并说明点击行为（切到前台 + 后续标注从该页取），ego lite 下多一枚「仅 agent 空间」提示。新增 e2e：绕开插件 `navigate` 直接 `Target.createTarget` 开页，断言 6s 内出现在标签条、数量 +1、点一下变当前页。

- **标签条平铺 + 「更多」弹层**：此前一行放不下就横向滚动，5 个标签就把这条挤成一条滑轨；现在从左到右换行平铺，直接给前 10 个，第 11 个起收进「更多 N」弹层，整行列出、选中后自动收起。切分逻辑下沉为 `lib/shared/tabs.js` 的 `splitTabs` 纯函数并补单测。

### Changed

- **标签标题不再停在 URL**：第二个标签页此前一直显示地址，因为标题只在 `Target.targetInfoChanged` 送达时更新，而事件常常在页面写好标题之前就到（甚至这一页 attach 前就改完了）。现在 `_upsertTab` 就地合并（不再 filter+push 打乱整排）、地址没变而事件没带标题时保留旧标题，并把合并规则下沉为 `mergeTab`；面板每秒轮询 `/state` 时 host 顺手 `Target.getTargets` 对一遍账（800ms 节流、指纹没变不 emit），标题晚了也会自动补上。e2e 增加断言：绕开 `navigate` 新开的页面，6s 内标题回填成页面里的 `<title>`。

- **「空间」一栏只在 ego lite 下显示**：Chrome / Edge 用插件专属 profile，整块环境本来就是隔离的，再叠一层 BrowserContext 只会让面板更复杂；ego lite 会与用户自己那一屏共存，才需要独立空间。`/space` 与 `/state.spaces` 对任何浏览器仍可用，只是面板不再渲染这一行。

- **标注交互界面重做视觉**：注入层换成一套独立的暖墨色切面（朱砂主色 `#ff7a45` + 等宽字体做元信息），不再跟随页面明暗，深色站点上也不会糊成一片。标注卡重排为「序号 / 元素名 / 尺寸 / 复制选择器」头部 + 选择器芯片 + 元素文字摘录 + 输入区 + 键位提示，卡片旁的小尖角指向目标元素并随翻转换向；拾取中的元素在卡片打开期间保持常亮（此前 `render()` 会清掉高亮，用户打字时看不出标的是谁），页面滚动/改窗口大小时卡片与高亮一起跟随。右下角胶囊与控制台改为半透明磨砂面，快捷键显示为 `⌥ A` / `Alt A`，新增「复制选择器」。随后按可读性反馈调了一轮字号与按钮尺寸：卡片正文 13.5px、元信息 12px、按钮高度 42~45px（此前约 34px）、提交按钮把快捷键拆成 `⌘` `↵` 两枚独立键帽（Windows/Linux 为 `Ctrl` `↵`）、左侧只留一枚 `Esc` 键帽不再重复「取消」、卡片右上「复制」放大到 26px 高、悬停标签 12px。注入层 REV 升到 9。
- **标注卡按钮对齐与跨平台键名**：`取消` 与 `添加标注` 此前一个 42px 一个 45px，顶部与底部各差 1.5px，看着像没对齐；现在同高 42px 并改用 `inline-flex` 居中，键帽也锁成 20px 高。键名按平台给：macOS 显示 `⌘` `⏎`，Windows/Linux 显示 `Ctrl` `Enter`（此前非 Mac 也画 `↵`；Mac 的 ↵ 在 12px 等宽字体里细得看不出是个键，换成更粗的 ⏎，单字符键帽再单独放大到 13px），按钮 `title` 同步；引用原文块去掉左边缘那条 2px 橙线，改用衬线体开引号做书签标记，正文不再手工包中文引号（顺带修掉 CSS 码点写成单反斜杠、被 JS 当八进制转义吃掉、卡片上画出字母 C 的问题）。注入层 REV 升到 10。
- **已连接时也能换浏览器**：`/launch` 收到与当前不同的 `browser` 会先关掉旧窗口（profile 保留）再起新实例，而不是只导航到同一窗口；面板的浏览器选择器从「未连接才显示」改为装了多个就常显，切换即生效。
- **`/close` 默认不再关窗**：从「关闭浏览器」改为「断开连接」，窗口、标签页与 profile 全部保留，下次 `/launch` 接回同一实例；真正关窗需显式 `{ terminate: true }`（面板菜单的「关闭浏览器」）。host 卸载（DSH 退出）时仍按 `terminate` 收尾，避免窗口留在桌面上。
- **ego lite 没有自带可调试页面时替它开一个**：ego lite 启动后只开自家 `chrome://` 界面（target 类型 `browser_ui`），`Target.getTargets` 里永远没有 `page`；`_waitForPage` 现在等 1.5s 仍无页面就 `Target.createTarget({url:'about:blank'})`，再走既有导航注入，否则只能等到超时。
- **ego lite 端到端用例覆盖「复用」**：`test/e2e-browsers.test.mjs` 新增一例——先自己起一个 headless ego，再由第二个 picker 通过它的 `DevToolsActivePort` 接管，断言不 spawn 新进程、切到自己的 agent 空间、断开后对方的进程仍活着；`npm run test:e2e` 默认带 `ADOPT_RUNNING=0`，不会跑到开发者日常开着的 ego 里开会话。
- **临时文件不再写进代码仓**：浏览器 profile 与元素截图从 `<cwd>/.dsh-visual-annotator/` 迁到操作系统临时目录 `<tmp>/dsh-visual-annotator/<项目名>-<cwd 哈希>/`，同名不同项目互不共享；新增 `DSH_VISUAL_ANNOTATOR_DIR` 覆盖根目录。落点计算下沉为 `lib/shared/scratch-dir.js` 纯函数并补单测。

### Removed

- **右上角「更多」里的「清空全部标注」与「关闭浏览器」**：前者与底部「清空」完全重复（工具条里那份还带条数角标，看着像两套操作）；后者之所以点了没反应，是因为菜单的开关里还引用着上一个版本删掉的 `setConfirmClear`，点「更多」当场抛 `ReferenceError`，整个菜单压根打不开（详见下面的 Fixed）。窗口现在由 DSH 退出时收尾（host 卸载仍走 `/close { terminate: true }`），想立刻关窗直接点浏览器自己的关闭按钮。

### Fixed

- **只写域名（`gitee.com`）打开的是 about:blank**：面板把输入框内容原样交给 `Target.createTarget`，缺协议的字符串不是合法 URL，Chromium 就开一页空白。新增 `lib/shared/url.js` 的 `normalizeAddress` 纯函数并补单测：裸域名补 `https://`、`localhost`/`127.0.0.1`/`[::1]` 补 `http://`（本地开发服务器基本都是 http）、已带协议原样保留、带空格当搜索词；`/launch`、`/navigate`、`/space` 三条入口统一在 host 归一化，面板在成功后把输入框同步成真实地址。实测真 Chrome：输入 `gitee.com` 打开 `https://gitee.com/`，标题为「Gitee - 基于 Git 的代码托管和研发协作平台」；e2e 增加「裸地址（带端口）也能打开」用例。

- **面板点「更多」没反应（`setConfirmClear is not defined`）**：这是上一个版本删掉「确认清空」两步操作时留下的引用，面板脚本没有打包也没有类型检查，只在用户点击那一刻炸。修掉该引用，并给 `lib/client.js` 打开 eslint `no-undef`（浏览器 globals 已配好），以后再删 state 却漏改引用会直接卡在 `npm run lint`。
- **重连后 agent 空间认错、切回原空间 cookie 不见了**：空间名此前只在内存里（重连时按「有没有页面」临时起名），于是 ego lite 断开再接回时，上次的 `agent 空间` 被改名成「空间」、插件又新建了一个空的 `agent 空间`，原有的页面看着「丢了」；默认空间的 context id 也取自「第一个连上的目标」，而 ego 启动后先连上的是空间页，取到的其实是 agent 空间——按空间切回来后读的是另一个 context，cookie 自然没有。现在空间 id 与名字按「项目 × 浏览器」落盘到 `spaces-<浏览器>.json`（新建/关闭/同步时写），默认空间的 id 改为按「带着页面、且不在 `Target.getBrowserContexts` 列表里」这条差别认回来，四条成功路径（外部 CDP / 接管运行中的 ego / 接回自有 profile / 新 spawn）都先对齐一次空间表。e2e 的 cookie 用例也改成按「启动所在的那个空间」相对断言，不再假设一定是默认空间。
- **宿主沙箱下 Chrome 起不来（`chrome connection is closed`）现在自己恢复**：宿主自带的沙箱让 Chrome 自己的 sandbox 装不上，浏览器进程在 CDP 握手后立刻 SIGTRAP，表现为「启动成功但所有调用都报连接已关闭」。现在 launch 在三处探活（connect 失败、connect 之后、seed 完成之前），一旦认出「**自己 spawn** 的实例已死」就带上 `--no-sandbox` 重试一次并继续（`/state.sandboxFallback` 变成 `true`、日志一条 warn），同时把「进程已死」当作快速失败信号传进 `_connectWithRetry` / `_waitForPage`，不再干等到 12s/20s 超时（实测首次启动从 6~16s 降到约 4s）。判定下沉为 `shouldTrySandboxFallback` 纯函数并补单测；接回的外部窗口不参与回退，设 `DSH_VISUAL_ANNOTATOR_SANDBOX_FALLBACK=0` 可整体关闭。
- **e2e 跑完不留浏览器进程与临时目录**：之前 teardown 直接 `rmSync` 临时 profile，会和还在退出的浏览器进程抢目录（`ENOTEMPTY`），异常路径下还会留下孤儿窗口。现在 `teardown` 先 `close({terminate:true})`、等 pid 真的消失（最多 5s）、再 `pkill -f <profileDir>` 兜掉 helper 子进程、最后才删目录（`maxRetries`）；文件末尾的 `after` 钩子把所有建过的临时目录再扫一遍，确保异常中断也不留账。
- **页面内悬浮菜单与快捷键提示从不显示**：注入层的 CSS 把 `.hud` 容器初始化成 `display:none`，而 `render()` 只切换它的子元素（`.pill` 胶囊 / `.cluster` 控制台），父容器从未被打开——于是 `⌥Option+A` 等快捷键虽然可用，用户却只能盲按。现由 `render()` 显式打开容器，控制台暂停按钮补 `Esc` 键帽、完成按钮说明 `⌘/Ctrl+Enter`；`lib/overlay.js` 的 REV 升到 7，已打开的页面下次 attach 自动换成新注入脚本。单测断言 `nodes.hud.style.display = 'block'` 仍在，e2e 在真实浏览器里校验 `.hud`/`.pill` 的 `computedStyle.display !== 'none'`。
- **`visual_annotator_read` 从未注册成功（agent 永远看不到该工具）**：工具定义里的可空/多类型字段写成了 `type: ['string','null']`、`type: ['string','integer']`，而 DSH 的 `tools.register()` 只接受单一 `type` 字符串（联合类型须用 `oneOf`），注册时抛 `JsonSchemaError` 并被插件静默吞掉。现改用 `oneOf` 表达，schema 下沉到 `lib/shared/tool-schema.js` 并加回归测试；注册改为等待 `tools` 服务就绪（`ctx.inject`）而非探测一次，失败仍记日志；`/state` 新增 `tool: { registered, error }`，未注册可直接看出来。

## [0.4.0] - 2026-11-09

### Added

- **页面内标注控制舱（HUD）**：底部提示升级为可交互 HUD——标注中显示「已标注 N 处 · ⏸ 暂停 · ↩ 撤销 · ✓ 完成·插入」，暂停/撤销/整批插入都不用再切回侧边栏；非标注态折叠为右下角胶囊「▶ 开启标注 · N 处」，点击即重开。页面内按 `Alt+A`（macOS 为 `⌥Option+A`）也能直接开关标注。
- **双向状态同步**：页面内 Esc/暂停/撤销/完成经 CDP binding（`kind: mode/undo/consume`）上报 host，host 以 `sync({mode,count})` 广播到全部标签页。「Esc 退出」从假承诺变成真退出，页面计数与面板列表以 host 为单一真相源。
- **撤销/记账逻辑下沉为纯函数**：新增 `lib/shared/binding-action.js`（binding 消息分类）与 `lib/shared/pick-actions.js`（弹栈撤销、consume 记号单调推进），session 只做薄委托，并补对应单测。

### Changed

- **完成即插入**：HUD「✓ 完成·插入」只推一个 `pendingConsume` 记号，面板轮询感知后自动走既有插入流水线（芯片优先、剪贴板兜底）；记号在插入成功后才消费，失败自动重试，避免静默丢失。
- **计数广播先行**：拾取记录先广播新计数再截图，消除慢截图 CDP 往返期间的页面计数漂移窗口。
- 移除/撤销/消费/清空统一收口到 `_afterRemoval`，撤销槽截图不再泄漏到窗口关闭。

### Fixed

- **「添加标注」点击无反应**：HUD 完成按钮与卡片提交按钮都带 `.pri`，`querySelector('.pri')` 误绑到 HUD 按钮；改为限定 `.card button.pri` 并加回归断言。
- **macOS 下 `Alt+A` 完全失效**：`Option` 是组合键，`event.key` 被组合成 `å`；改为按物理键 `event.code === 'KeyA'` 判定（面板与页面内一致），提示文案按平台显示 `⌥Option+A` / `Alt+A`，页面胶囊新增快捷键徽章。
- **浏览器无快捷键提示**：HUD 胶囊与面板文案现在都带可见快捷键提示。
- `close()` 改走 `sync()` 唯一同步口，旧版叠加层也能正确收到 off。

## [0.3.1] - 2026-11-07

### Added

- **商店图标**：新增 `assets/icon-180.png`（180×180，市场卡片用的 GitHub 托管位图）与可复现的生成脚本 `scripts/make-icon.py`；图标由 Pillow 4 倍超采样后降采样得到，无需设计源文件。

### Changed

- **发版流水线校验无版本号资产真的能下载**（`release.yml`）：市场条目把 tarball 写死成 `releases/latest/download/dsh-visual-annotator.tgz`，资产名对不上或 `latest` 指向别的 release 都是静默 404。现在 Pack 阶段校验两份 tgz 的 sha256 一致，发布后新增一步：列出 release 资产确认存在无版本号文件，再用 `curl` 真实下载该 URL（`latest` 重定向未生效时重试 5 次）并检查包内 `package/lib/index.js`。同时让创建 Release 幂等——已存在就走 `gh release upload --clobber`，校验失败重跑即可自愈。
- **发版资产多一份不带版本号的文件名**：`npm pack` 之后额外复制成 `dist/dsh-visual-annotator.tgz` 一起上传，供市场列表的 `releases/latest/download/dsh-visual-annotator.tgz` 链接使用——`latest` 只解析重定向、文件名照字面取，带版本号的名字在下一次发版后会 404。

## [0.3.0] - 2026-11-06

### Added

- **一键清空标注**：底部动作区在「全部插入」旁新增「清空」按钮（有标注时才可用），右上角菜单里的「清空全部标注」也取消了两步确认，点一次即清空；提示条给出一次性「撤销」，可整批恢复（含截图）。host 的 `clear()` 改为把整批移入归档并返回 `cleared` 条数，因此清空后已插入草稿里的芯片仍能解析、误清可整批撤回；归档只在窗口关闭或超过 200 条时释放截图。旧宿主（无 `cleared`）会回退逐条 `/remove` 并明说「无法整批撤销」。

### Changed

- **插入即消费**（面板 v11）：插入成功后标注从列表移除，并保留一次性「撤销」；下一轮标注从零开始，不再需要手动逐条清空上一轮的残留。host 新增 `POST /consume`（截图移入 `retired`，文件随 `clear()`/`close()` 释放，已插入的芯片提交时仍能取到路径）；`/restore` 改为整批恢复并返回恢复条数；新增 3 条单测覆盖 consume / 整批恢复语义。
- **只保留引用一种插入形态**：删除「引用 / 详细」分段控件与详细文本分支、`dsh-visual-annotator-insert-mode` 存储键；芯片在提交时展开为完整定位块。
- **底部动作区改版**：卡片按钮统一为「插入」，主按钮改为「全部插入（N 条）」，其下新增一行 11px 提示（窄轨 ≤320px 隐藏）说明「插入后自动清空；误操作可撤销」。

### Fixed

- **宿主还是旧版时「列表清空失败」**：面板已升到 v11+，但正在运行的 DSH 仍是早于 `/consume` 的构建，`POST /consume` 返回 404，于是插入后提示「已插入 3 条标注…但列表清空失败，请手动删除」，等于功能没生效。现在 `consumeInserted` 在 `/consume` 不可用（或批量失败）时自动逐条回退 `POST /remove`，列表照样清空，提示改为「列表已清空（撤销只能恢复最后 1 条；重启 DSH 后可整批撤销）」。`PANEL_BUILD`/`HOST_REV` 升到 v13。
- **第二轮标注的芯片全部退化成「该标注已被清除」**：输入触发器的 source 每个 GUI 会话只登记一次，保留的是**第一个面板脚本实例**的 codec 闭包；面板脚本被重新拉取（`HOST_REV` 变化、模块热替换）后，新实例把标注写进新对象，旧 codec 永远读不到，于是「插入过的那一轮还能展开，之后新增的一律变成已清除」。芯片登记表改为挂在 `window.__DSH_VP_CHIPS__` 上并每次动态取用，旧 codec 也能读到新数据；本地查不到时回退到新增的 `POST /pick` 向 host 取（命中后写回），被消费/已插入的标注仍然可解析；host 侧新增 `findPick()` / `readablePicks()`，`visual_annotator_read` 改为读「现存 + 已插入归档」，因此芯片在插入后任意时刻提交都能取到详情。占位文案同时改为带 `ids` 的调用示例。新增 `test/client-chip-registry.test.mjs`（3 条：重新拉取后仍可展开 / 回源 host / 都查不到时给出 ids 提示）与 `test/session-archive.test.mjs`。
- **小字看不清（面板 + 页面内浮层）**：面板元信息整体上调一级（10→11px、11→12px），元素名/评论框/菜单/按钮 12→13px，评论框高度 44/120px → 46/132px，等宽选择器 `11px/1.45` → `12px/1.5`；页面内拾取浮层同步上调（标签与选择器 11→12px、标题与按钮 12→13px，标签内边距加大）。
- **弹出窗口过小 / 像是被缩放**：新 profile 的窗口尺寸完全由 Chrome 自选，在 4K 高缩放桌面上会开成一块偏小的窗口，整窗（浏览器按钮 + 页面内容）看上去都被缩小了一个比例。启动参数改为默认 `--start-maximized`（无头自测不加），并新增 `DSH_VISUAL_ANNOTATOR_WINDOW=1440x900` 用于指定精确尺寸。

## [0.2.0] - 2026-11-05

### Added

- **面板 v10（UX 重构）**：状态胶囊（未连接 / 启动中 / 已连接 / 标注中）、可点的三步空态、标注模式开关（`Alt+A`）、插入形态说明、`Ctrl/⌘+Enter` 全部插入、导出菜单（关闭浏览器 / 清空全部并二次确认）。
- **标注卡片重构**：序号 + 元素标签 + 所属页面、缩略图与「定位」按钮可在浏览器中高亮并滚动到该元素（`POST /focus`，页面内 `__DSH_VP__.highlight`）、选择器单击复制、评论防抖自动保存并显示保存态。
- **撤销删除**：`POST /restore` 恢复最近一条被删标注（截图文件延迟释放）。
- 无障碍：`:focus-visible` 焦点环、`role="status"`/`role="alert"` 播报、评论框 `aria-label`、浮层卡片 `role="dialog"` + 焦点陷阱与还原。
- 响应式：面板根节点容器查询三档（≥320 / 320 / 260px），窄轨下卡片转纵向、页脚不再溢出。

### Changed

- 工程门径：ESLint（flat config，host/browser 双环境）、Prettier、`.editorconfig`、`npm run verify` 一键校验。
- 单元测试（node --test）：`lib/shared/gui-page.js`（GUI 页面识别）与 `lib/index.js` 纯函数（normalizeShots / filteredPicksMarkdown）。
- CI workflow（`ci.yml`）：lint + 语法检查 + 单测 + 格式检查 + manifest 校验，PR/push 触发，带并发取消。
- AI-Native 协作文档：`AGENTS.md`（代理工作约定、硬性约束、命令）与 `docs/API.md`（HTTP 路由 + agent 工具契约）。

### Changed

- **发布流水线加固**（`release.yml`）：新增 tag↔package.json 版本一致性 guard；发布前强制跑 `npm run verify`；GitHub Release 用 `--generate-notes`；NPM_TOKEN 缺失时警告并跳过 npm publish。
- 重构：GUI 页面识别逻辑抽到 `lib/shared/gui-page.js`（纯函数，host/browser 可复用），`session.js._isGuiPage` 改为薄委托。
- 清理：移除未使用的 `node:http` 导入与残留变量。
- `HOST_REV` v6 → v7（client.js 经 Prettier 全量格式化，GUI 需强拉新面板），v10 起改为 `v10-<构建时间戳>`。
- 新增 HTTP 路由 `/focus`、`/restore`，面板与 host 需同版本（旧 host 缺路由时按钮会提示失败）。

## [0.1.0] - 2026-11-05

### Added

- 首个版本：真实 Chrome/Edge 页面元素拾取、标注、评论、截图；标注以定位文本 + 截图附件交给 agent；引用/详细两种插入模式；Tab 切换与接管已存活浏览器。
- GitHub Actions 发布流水线（tag `v*` 触发）。
