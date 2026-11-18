# 更新日志

本文件记录 dsh-annotator 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### Added

- **HUD 能拖着走了**：控制台与折叠胶囊各带一个拖拽把手，拖到哪儿就记在哪儿（按站点存本地，同一站点的每个页面都沿用）；双击把手或聚焦后按 `Home` 回到右下角，方向键微调（`Shift` 细调）。窗口变小后位置会被重新钳进可见区——拖出屏幕的 HUD 用户再也点不到，只能刷新页面。提示条跟着 HUD 走（原来固定钉在右下角，HUD 一挪就跑到毫不相干的地方）。
- **零标注时「复制提示词」是禁用的**：以前点了才知道没内容，现在按钮直接灰掉并写明原因。判据是**全部标注条数**，不是本页条数——复制出去的是所有页面的标注，别的页面有标注时这里必须还能点。
- **改动区 / 参照区各自能直接清空**：两栏表头各加一个「清空」，空栏自动禁用（原来只有菜单里那三项，用户得先想起来还有菜单）。清空仍然整批入归档，能在提示条上撤销。
- **提示词里写清「坐标只是快照，定位以选择器为准」**：`位置：x=688 y=364 273×20` 是拾取那一瞬的页面坐标（CSS px，滚动与窗口位置都不影响它），但窗口尺寸、页面缩放、响应式重排和异步内容都会把它挪走。以前这一行没有任何限定，读提示词的 agent 很容易把坐标当成元素身份，换个窗口尺寸就认错。现在「执行要求」开头固定一句定位口径（选择器优先、失配时按标签 + 文本 + HTML 片段重新找），坐标后面也标着「（快照，仅供对照）」。两种形态（普通 / 改动↔参照）共用同一句。
- **HUD 的「改动 / 参照」开关带上键帽了**：以前只有悬停提示里写着 `⌥R`，暂停却明晃晃挂着 Esc，等于把换栏藏成了一个秘密。现在两段开关尾部就有一枚键帽，macOS 显示 `⌥ R`、Windows/Linux 显示 `Alt+R`，文案仍只来自 `HOTKEY_R` 一处。展开的控制台与折叠胶囊各一份。
- **支持勾选多条再一起清空**：每条标注卡片序号左边有勾选框，勾选后栏头下方出现「已选 N 条 · 全选 · 取消选择 · 清空所选」。`/clear` 新增 `ids` 参数（与 `scope` 取交集），一次请求清掉勾选的条目并整批可撤销；旧宿主（host < v57）不认这个参数，面板自动退回逐条 `/remove`，避免把整栏误清。

### Fixed

- **点缩略图又能放大看截图了（普通模式与参考对照都修好）**：v10 的交互改版把普通卡缩略图的点击从「打开大图」换成了「在浏览器中定位」，两栏卡（改动 / 参照）的小图则从来没有点击处理——用户手上只剩 96×72 与 54×36 两档缩略图，元素里的文字、间距、圆角全看不清，等于把「照着这处改」最直接的证据藏起来了。现在两栏小图也能点（`role=button`，可 Tab 聚焦，Enter / Space 同样放大），普通卡的小图点开的是大图而不是定位（定位仍走卡片头部的目标图标与「在页面中定位」）。大图用原生 `<dialog>.showModal()` 挂在 `document.body` 上：面板根是 `container-type:inline-size` 的容器（布局包含 = fixed 定位的包含块）又在侧栏 `overflow` 里，放在面板内部再怎么 fixed 也只有侧栏那么宽，只有 top layer 能盖住整个窗口。点任意处 / `Esc` / 右上角 ✕ 都能关，关闭后焦点回到打开它的那张缩略图，面板卸载时放大层一并收掉。面板构建号 v57→v58。
- **HUD 最左边的把手显示成一个「807」**：那个位置是拖动把手，本意是画一个六点抓握字形，但码点写成了 `content:"\2807"`，而它住在注入脚本的字符串里——页面端 JS 先把 `\2` 当作八进制转义吃掉，CSS 只收到一个控制符加字面量 `807`，于是用户看到的就是三个数字。现在把手换成内联 SVG 的两列六点：不吃转义、不挑字体，也不再触发同一个坑（`test/overlay-script.test.mjs` 加了一条通杀断言，注入脚本里的 CSS 码点必须双反斜杠）。注入层 REV 升到 21。
- **canary 夹具搬齐整个 `lib/`**：夹具原来只拷 `index.js` / `client.js` / `overlay.js` 三个入口。overlay 开始从 `lib/shared/` 里 import 纯函数后，夹具里那条「干净 lib 必须放行」的阴性对照被自己的夹具弄红（`overlay-import: Cannot find module .../shared/hud-position.js`），canary 整体失败，评分器因此丢掉 canary 那几分——表现出来像是「M15 变异存活」的自证失效，其实是夹具缺文件。改成整目录递归拷贝后基线回到 100/100，16 个变异全部被检出。

## [0.6.1] - 2026-11-18

### Fixed

- **标签条不再可能一条都不显示**：默认空间的 context id 原来靠「第一个不属于已知空间的目标」去猜，而一个真实 profile 里同时躺着好几个 context（扩展的 service worker、内部页、另一个窗口的页各带一个），猜错一次就会把用户眼前这一页判成「别的空间」从标签条里筛掉——浏览器里页面好好的、HUD 也能点，面板却报「没有标签」。现在优先听 CDP 自己在 `Target.getBrowserContexts` 里给的 `defaultBrowserContextId`，其次看用户正在看的那一页落在哪个 context，且**认不出来的 context 一律算默认空间**（明确属于某个空间的标签才排除）。这也是 2026-11-18 main 上 `Browser e2e` 那条 `0 !== 1` 假红的真因。
- **幽灵标签会被剪掉**：`refreshTabs` 原来只增不删，浏览器启动那一瞬被销毁的目标（事件在开「发现」之前就发生完了）会永远留在标签条上，点它什么也不会发生。现在每次对账都按 `Target.getTargets` 补新增、删已消失，并清掉它的 CDP 会话与注入状态；启动与接回窗口返回 `ready` 之前就各对一次，`/state` 第一次给出的标签条就是浏览器真实的那一排。

## [0.6.0] - 2026-11-18

### Added

- **参考对照（Reference Mode）**：「照这个页面做那个页面」现在只要切一个模式。模式切换是一个胶囊分段控件（普通标注 N / 参考对照 M）；参考对照里一条改动一行：左栏「改」是要改的标注，右栏是它照着的那几条参考，中间那条线就是对应关系。设计见 [docs/reference-mode.md](docs/reference-mode.md)。
- **一条改动可以照好几处**：配对从 1:1 改成 1:N——目标标注的 `pairIds` 是它参照的全部参考（`pairId` 仍等于第一条，旧数据与旧契约照旧可读）；插入文本按「照这几处（同一处改动，几处规范一起用）」逐条列出，agent 一行就能看全。目标页只留 1 个，参考页可多选（最多 5 个）。
- **落点先点后标，落错也当场纠正**：右栏的「＋ 照这里 / ＋ 再照一处」是真按钮，点一下进入待落位（提示条写明「下一处落进「照」」并给「取消」）。以前在目标页上标，这一处照样落进「改」，只弹一句「这次落进了「改」」；现在直接把它改成要的那一栏（单条覆盖，不动整页）再配对，提示「这一处已归到「照」」。（v0.6 起取消事后纠正：宿主落标即定角色，见上）
- **拖拽配对**：参考卡拖到某条改动上 = 追加配对（已在这一组里会提示，不重复加）；改动卡拖到参考卡上同样追加；参考卡上的 × 或编辑器里的「移出这组」只解开这一条，标注本身保留。孤立参考拖进左栏即可归位。
- **去掉了顶部那排「改这里 / 照这个」**：它和下方左右分栏表达的是同一件事，用户要在两处建立同一个心智。页面身份改成两栏表头自带（左「改 · 目标页名」/ 右「照 · 参考页名 等 N 页」），点表头在栏内换页。（v0.6 起页面身份也移出栏头：栏头只有「改动 N / 参照 M」，归属由标注自己带）
- **参考页只读**：参考页悬浮层换成蓝色「参考 R1」徽标与「要参考这里的什么？」措辞，并带布局/间距/配色/字号/圆角/交互/文案七个维度快捷标签；插入文本按「改 / 照」成对写出，并写明「参考页只读，禁止修改参考页及其代码」。参考标注插入后保留并标「已引用」，下一轮默认不再带。
- **Agent 侧契约**：`visual_annotator_read` 新增 `roles` 过滤；标注带 `role` / `roleSource` / `pairIds`（目标→全部参考）/ `pairId`（= 第一条，兼容旧用法）/ `pairedTargets`（参考→目标）/ `pageKey` / `refLabel` / `spec` / `included` / `referenced` / `pageClosed`；markdown 里每个目标下面都有一行「参照：R1-1、R2-2 的配色、圆角」。
- **清空分口径**：清空目标标注 / 清空参考标注 / 全部清空，参考集不会被顺手清掉。
- **参考可以用多页、也能批量套用**：参考页可多选（再点已选中的退回普通页，最多 5 个，右格编号 R1-1 / R2-1 不串号）；行内编辑器加「套用其余 N 条」，把一条参考一次配给所有还没配对的目标，已配好的不覆盖。
- **普通模式也看得见参考**：列表顶部一条「照 N 条参考标注 · K 条已配对 · 看对应 →」，点一下切到参考对照，不用先猜参考是不是还在。
- **待配对参考单独成节**：没人认领的参考不再挤成空左格，而是收进「还没配给哪条改动的参考 N」小节，拖到左边某组，或点「配给某条改动」再点左栏一条。
- **配对不会留悬空**：删除标注、撤销、清空参考时，所有目标 `pairIds` 里的它一起解开（`clearPairTo`，单测覆盖）；参考页被关掉时标注保留并标「页面已关闭」，重开同一地址自动挂回。
- **提示条不再盖住标注**：原来提示条绝对定位在底部按钮上方 92px，标到第三处就会被它压住；现在走文档流，排在底部按钮上方。
- **没对照就不给插**：参考对照里只标了「改」、一条「照」都还没有时，底部「插入对照」是灰的（悬停说明「还没有「照」的标注：先标一处参考」），Ctrl/⌘+Enter 与页面 HUD 的「完成·插入」同样不起作用，改弹一条提示而不是把目标标注当对照插进去。
- 新增 `lib/shared/page-roles.js`（纯函数：页面角色、R 编号、1:N 配对、pick 继承与覆盖、包含集、委托摘要）与 `test/page-roles.test.mjs`（16 用例）。

- **HUD 上一键换落点（`⌥R` / `Alt+R`）**：标注模式的控制台里多了一个「改动 / 参照」两段开关，点一下就换下一处进哪一栏，不用回面板点按钮；参照态整块换蓝并写「参考 R…」。在任意标签页按 `⌥R` 同样生效，HUD 会顺手进标注模式。落点仍然只有一个真相源（host 的 `arming`）：页面经 binding `kind='landing'` 上报，面板通过 `/state` 镜像过来；落点第一次从改动变成参照时面板自动进参照模式，之后用户自己切回普通模式不会再被拉回。
- **HUD 一键复制提示词（`⌥C` / `Alt+C`）**：展开的控制台和折叠的小胶囊里都有「复制提示词」，复制的就是面板那份 Markdown（同一份实现），可以直接粘给别的 Agent；没有标注时先提示去点元素。`navigator.clipboard` 在 http 页面上不可用时回落到 `execCommand('copy')`。
- **折叠胶囊里也能换落点**：胶囊不再只有一个「+ N」按钮，里面同样有「改动 / 参照」两段开关与复制按钮；点「参照」＝落点切到参照并进标注模式。以前普通态折叠着就没法换栏，必须回面板点按钮。
- **面板跟随 HUD 的落点**：`/state` 回传的 `arming` 现在被面板采纳（值没变不重渲染），HUD 换了落点、面板的落点色条与按钮高亮会跟上，不再各说一套。

### Changed

- **两栏栏头改叫「改动区 / 参照区」**：栏头原来只写「改动 N / 参照 M」，读起来像一个角色标签而不是一块区域；现在左右栏头分别写「改动区」「参照区」，与卡片的归属语义分开——栏头说的是「这一块放什么」，卡片说的是「这一条是什么」。
- **角色属于标注，不再有「选目标页 / 选参照页」**：原来面板要分别为「改动」「参照」各选一个页面，加上顶部标签条就是三份清单，很容易对不上；而改动的参照本来就可以来自它自己那一页。现在页面不再有角色——同一页可以既有改动又有参照，归属只由标注自己带，左右两栏表达的就是「这条归哪一栏」。
- **落点按钮变粘性**：「＋ 新增改动」「＋ 添加参照」点一下选定下一处进哪一栏，之后在任意标签页连点几处都归这一栏，再点同一颗按钮才取消（10 分钟不操作也过期）。宿主在落标当时就定下角色（`roleSource='landing'`），面板不再事后纠正「这一处已归到『参照』」。
- **参照落点顺手配一条改动**：卡下「＋ 新标注一处参照」会指定配对目标；否则自动配给第一条还没配参照的改动，配完这一处就清掉目标、落点保留。
- **R 编号从标注派生**：R1..Rn 按参照标注首次出现的页序排，同一页多条是 R1-1 / R1-2 不串号；某页参照删光后编号自动重排，host 与面板用同一份 picks 计算。
- **两栏栏头只剩角色与数量**（左「改动 N」/ 右「参照 M」），页面身份改写在卡片上；顶部标签条是唯一的页面清单。
- **契约变更（破坏性）**：`visual_annotator_read` 的 picks 里 `role` 是唯一权威；`roleSource` 取值改为 `landing` / `auto` / `user`；`pages[]` 去掉 `role` / `refIndex` / `targetId`，改带 `label` 与 `counts{target,reference,total}`；`/page-role` 路由与 `setPageRole` / `rewritePickRoles` 删除；`/arm` 语义改为落点（`{slot,pairId}` 或 `null`）。面板 `PANEL_BUILD` v47 / `HOST_REV` v47 / 注入层 `REV 14`。
- 设计规范同步更新：[docs/reference-mode.md](docs/reference-mode.md) 的核心模型、交互表与验收清单按新模型改写，[docs/API.md](docs/API.md) 补上参照对照路由。

- **提示词把「改动 ↔ 参照」对照关系与执行意图写在明面上**：生成文本从三处重复实现收成一份（`lib/shared/annotation-markdown.js`，host、工具、面板/HUD 共用）。有参照时首行先报「X 处改动 / Y 处参照」，第二段是一句**任务句**（`TASK_REFERENCE`：「按「改动」标注修改对应元素；「参照」只提供样式与结构，别改它指向的元素，也别改它的代码」），再给编号 1..4 的「执行要求」（只改带 T 编号的那几处、带 R 编号的只取样式不改其元素与代码、改动与参照可以同页、按「参照：」行照做并写明没写维度就整体对齐与冲突以先列者为准、改完逐条自检）；没有参照时同样给 `TASK_PLAIN` 与三条要求，编号仍是单块数字。参照与改动各按页面分节，每条 T 行后必有「参照：R1-1 的配色、圆角（只改这一处）」一行，没配对写「参照：未指定参照标注」。以前 host 拼的那份没有「参照：」行，面板复制出去的提示词里对照关系整个丢了。
- **提示词不再假设「目标页 / 参照页」两个角色**：插入文本的首行、chips 分节头、Markdown 分节标题与面板空态/按钮提示统一改成「按标注划边界」——只改带 T 编号的那几处，参照可以与改动在同一页；同一页时两侧都写明只读范围。改动分散在多个标签页时按页各分一节，T 编号连续（旧实现把所有改动塞进一个「目标页」标题下）。
- **一处改动在面板里有框、有显眼的号**：改动卡加暖橙竖线与同色描边，序号从灰色小字改成暖橙浅底徽标（1 / 2 / 3），参照序号改成同款蓝底徽标（R1-1），只当索引、不与正文抢视线，参照卡上的归属 chip 写成「→ 改动 2」并用同一个暖橙。以前两栏都是同一种蓝、序号只是 10px 灰字，用户看不出「这条改动照的是哪几处」。
- **HUD 键位文案改成 Windows 习惯的 `Alt+A` / `Alt+R`**：判定本来就走物理键 `e.code`，两个平台共用一套分支；这次补上输入法组合（`isComposing` / keyCode 229）时让键，中文输入法下按 Alt 组合不会打断上屏。
- **只读边界改回「按标注划」的一致口径**：工具描述、工具 schema 的 `refLabel` 说明、`docs/reference-mode.md` 的目标条目改成「只读的是这条参照标注指向的元素，不是它所在的整页」——参照与改动同页时，agent 照常改改动那处。此前同一句描述里前半句说「与出自哪个标签页无关」、后半句又说「禁止修改参照标注所在页面」，两头打架。
- **面板两栏之间有真分隔线、正文左缘对齐**：栏头与两栏都改成 `gap:0`、第二列 `padding-left:12px` + `border-left`，竖线落在正中线且与栏头那条同一条；改动卡 3px 左边框用 `padding-left:6px` 补回、参照卡 1px 边框 + 8px 内距，两种卡的内距都是 9px（此前 8px vs 6px，两栏内容差 2px，怎么调都像没对齐）；序号块统一 18×18、徽标 `margin-left:auto` 一律靠右、17px 高，「＋ 新增改动 / ＋ 添加参照」定高 34。
- **卡下的「＋ 添加参照 ▾」改成浮层**：菜单原来是文档流里的内联块（`width:100%`），一展开就把左栏撑高、看起来像右栏卡片的重复副本；现在绝对定位在卡片下方、带阴影与 `z-index:30`，不再挤动任何一栏。
- **每颗标注卡定高、两栏按钮贴底对齐**：卡片固定 56px 高，说明固定一行、超出省略（点开卡是行内编辑器，看全也在那里改），参考维度做成 chip 并进说明行右端——左栏卡没有维度行、右栏有，两栏卡片原来一高一低；两列 `align-items:stretch` + 「＋ 新增改动 / ＋ 添加参照」`margin-top:auto`，卡数不同的两栏按钮也落在同一条横线上。
- **一条参照被多条改动引用时，归属写全**：右栏归属 chip 从只报第一条改成「→ 改动 1、2」（一条参照挂给两条改动本来允许，之前面板只显示第一条，用户会以为第二条没生效）；展开的编辑器头部同样列全，chip 过长单行省略、不撑开关系行。
- **两栏逐行对齐靠「关系行」而不是空白占位**：每颗卡下面固定 26px 一条关系行——左栏是「参照：R1-1 × … ＋ 添加参照」，右栏是归属「→ 改动 1 / 已引用 / 未配对」并容纳「再次引用」；两栏组高因此恒等（56+6+26=88），卡数不同也逐行对得上，靠塞空白行凑高度的话左栏 chips 一换行就再次错位。左栏 chips 改单行不换行（超出横向截断），归属徽标也从卡头挪进关系行。
- **缩略图与文字之间有过渡、选择器按正文色可读**：缩略图从 64×40 收到 54×36、加 1px 内描边，与文字留 10px——原来图顶满卡片内容区、灰底直接贴住文字，看着像图压在字上；元素选择器从 11px 的 `--vp-muted` 灰字改成 11.5px 正文色压半档（opacity .82），`#_SCROLL_EL_ID` 这类全大写下划线 id 不再糊成一条灰线；序号实心块改成浅底同色字徽标，不再和选择器一起抢正文的视线。
- **插入文案去掉工具名歧义**：「标注详情与截图由 dsh-annotator 插件的 `visual_annotator_read` 工具按 id 提供」——真实注册名是 `visual_annotator_read`（插件名 dsh-annotator），只写插件名会把 agent 指向一个不存在的工具。

### Fixed

- **新开的标签页不再「没有标注层」**：原来一个标签页只有 `Target.targetCreated` 一次机会，那一次 attach 或注入失败就永久没有 HUD，⌥A 也唤不出来。现在 `refreshTabs` 会补挂失联的标签页、`Page.loadEventFired` 也会重注入；注入前先探针（`window.__DSH_VP__` + HUD 节点），半死状态走 `reattach`，全丢则整段重注入。面板标签条上，出问题的那一页带一个警示点，点它可立即重试；宿主日志会写「标签页 X 注入标注层失败，面板会继续重试」/「标注层已补上」。
- **后台标签页拿到自己的角色**：HUD 的文案与「参考 R1」徽标原来按当前活动页的 URL 算，于是把第二个标签页设成参考页、人还留在第一个页面上时，那一页仍显示「怎么改」。现在按每个标签页自己的 URL 推（`pageHudInfo`，单测覆盖），计数也按页分开。

- **HUD 的落点开关被按钮样式压成普通按钮**：`.hud button`（0,1,1）压过 `.seg-b`（0,1,0），两段开关被画成 28px 带边框按钮、把 28px 的底槽撑破（实测 48x28，应为 41x22）。按钮样式改为只作用于两条工具条上的直接按钮，单测留一条回归断言。
- **HUD 计数被 flex gap 拆成三截**：「已标注」「0」「处」是三个 flex 项、各隔 7px，截图里读成两句话；包进一个 span 按 baseline 排。
- **HUD 换落点时的提示条从来没出现过**：`setLanding` 调用了一个不存在的局部函数 `flash`，换落点当场抛 `ReferenceError`，提示条与随后的 flush 一起被吞（落点其实换了，只是没有任何反馈）。补上真正的 `flash`（局部唯一实现，对外 API 委托它）。
- **普通模式点回被轮询无声拉回参照模式**：`adoptArming` 每 1.5s 轮询都无条件 `setViewMode('pair')`，用户点「普通模式」后下一拍就被拽回去。改成只在落点从改动变参照的那一拍切一次。
- **落点过期不广播**：10 分钟无操作时 `_landing()` 直接清 `state.arming`，面板色条与 HUD 颜色一直亮到下一次快照；改为走 `setArming(null)` 同一条广播路径。
- **普通模式看不见参照标注**：普通模式只列改动，HUD 参照落点标出来的那几处既不显示也不参与插入；列表顶部补一条「还有 N 处参照（切到参照模式）」。
- **点了「＋ 添加参照」HUD 仍是橙色的「改动」**：`setArming` 只把落点存进 state，既没 `_emit` 也没推 `_applyMode`，页面侧永远收不到 `landing`，于是颜色、措辞、以及 HUD 上的参考编号全停在「改动」。现在落点一变就广播一次（取消落点同理）。

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

### 勘误（2026-11-12）

- **上条中「GitHub 仓库名、市场收录页 slug 不变」与现状不符**：GitHub 仓库现已改名为 `ZhongqiXiao/dsh-annotator`（旧名 `ZhongqiXiao/dsh-visual-annotator` 走 301 重定向），市场收录页 slug 同步为 `zhongqixiao/dsh-annotator`；旧名链接经重定向继续可用，运行时内部标识（路由 `/api/visual-annotator/*`、agent 工具 `visual_annotator_read`、临时目录名）确实未变。从仓库安装请使用新名：`github:zhongqixiao/dsh-annotator`。

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
