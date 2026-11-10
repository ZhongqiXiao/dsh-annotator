# 插件 API 契约

## HTTP 路由（均挂 `/api/visual-annotator`，v4+ 需 DSH GUI 凭据）

| 方法 | 路径        | 作用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET  | `/state`    | 面板状态轮询：`{ ok, rev, mode, url, title, tabs[], picks[], archived, activeTargetId, reused, cdpBase, windowKept, resumed, tool, spaces[], space, spaceName, sandboxFallback, browserOrder, browserLabels, browserDefault }`（`spaces` 首项恒为默认空间、其 `id` 为 `''`；`tabs` 只列当前空间的页面）（`archived` = 已消费归档条数；`reused = true` 表示当前连的是外部浏览器、`cdpBase` 是它的调试端点；`windowKept = true` 表示已断开但窗口与 profile 仍保留；`resumed = true` 表示这次是接回已有 profile 的实例而非新起进程；`tool = { registered, error }` 说明工具是否真的进了注册表；`sandboxFallback = true` 表示本次实例是靠 `--no-sandbox` 回退起起来的，可用 `DSH_VISUAL_ANNOTATOR_SANDBOX_FALLBACK=0` 关掉该回退） |
| POST | `/launch`   | 复用/启动/接管浏览器，`{ browser?: 'chrome'\|'edge'\|'ego', url?, cwd? }`：不传时用第一个装了的浏览器（顺序 chrome → edge → ego）；按 profile 目录重连已有实例，没有才启动专用实例（`cwd` 只用于决定临时子目录）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| POST | `/probe`    | 探测可用浏览器                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| POST | `/mode`     | 切换拾取层模式 `{ mode }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| POST | `/navigate` | 当前 Tab 跳转 `{ url }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| POST | `/tab`      | 切换活动 Tab `{ targetId }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| POST | `/space`    | 调试空间 `{ action: 'create'\|'use'\|'close', name?, id?, url? }`：空间 = 独立的 Chromium BrowserContext，同一窗口内隔离 cookie / localStorage / 标签页。`create` 新建并切过去（重名自动编号成「空间 2」），`use` 切换（`id: ''` 回默认空间），`close` 销毁该 context（连带其页面与 cookie）后回默认空间                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST | `/comment`  | 写入某标注评论 `{ id, comment }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

| POST | `/remove` | 删除标注 `{ id }`（截图文件延迟释放，供 `/restore` 撤销） |
| POST | `/consume` | 插入后消费标注 `{ ids?: number[] }`，返回 `{ ok, consumed, ...snapshot }`（截图移入 retired，`/restore` 仍可整批撤销） |
| POST | `/pick` | 解析单个标注 `{ id }`，返回 `{ ok, pick, archived }`；`pick` 也包含已消费（已插入）的归档标注，供 chip 在提交时回源 |
| POST | `/restore` | 撤销最近一次删除/消费，返回 `{ ok, restored, ...snapshot }`（`restored` 为恢复条数） |
| POST | `/focus` | 在浏览器中定位某标注 `{ id }`，返回 `{ ok, focused, ...snapshot }` |
| POST | `/clear` | 清空全部标注，返回 `{ ok, cleared, ...snapshot }`；整批入归档可被 `/restore` 撤销，`cleared === 0` 时不动归档 |
| POST | `/close` | `{ terminate?: boolean }`：缺省只断开 socket，窗口与 profile 保留，下次 `/launch` 接回同一实例；`terminate: true` 才 `Browser.close` 关窗（profile 仍保留） |
| GET | `/shot?id=` | 取某标注截图 PNG

**面板里「空间」一栏只在 ego lite 下渲染**（`/state.space` 等字段对任何浏览器都会返回，`/space` 也能调）：Chrome / Edge 用插件专属 profile，一整块就是隔离环境，不再叠一层空间。标签条实时跟随浏览器——host 在 `_seedTabs()` 里打开 `Target.setDiscoverTargets`，用户在窗口里自己开的页会通过 `Target.targetCreated` 进来，当前页的标题/地址随 `Target.targetInfoChanged` 更新。 |

## Agent 工具

- **`visual_annotator_read`**：读取标注列表，参数 `ids?: string[]`（id 过滤，形如 `["p1"]`）、`shots?: 'none'\|'all'\|number`（截图附件数，默认最新 3 张）、`wait_seconds?: number`（0-60，等新标注）；读取源是 `picker.readablePicks()`（现存 + 已插入归档），因此芯片在被消费后依然读得到。
- 工具的 JSON Schema 受 DSH 注册表限制：`type` 必须是单个字符串，联合类型只能写成 `oneOf`（`type: ['string','null']` 会让 `register()` 抛 `JsonSchemaError`，工具静默消失）。schema 定义在 `lib/shared/tool-schema.js`，由 `test/tool-schema.test.mjs` 守住这个子集；`/state` 的 `tool` 字段可确认注册状态。
- 插入到 composer 的引用格式：`[标注 #<id>] <评论> ｜ <定位行>`；agent 看到该标记时应调用 `visual_annotator_read`（可带 `ids`）换取完整 selector/URL/坐标/截图。
- composer 内的 chip 由 GUI reference source `visual-annotator` 注册（`lib/client.js` ensureVpSource，`apply()` 时即登记），提交时由 `serializeReference` 展开为完整定位文本；chip 失败时回退纯文本插入。
- chip 序列化读取的登记表是 `window.__DSH_VP_CHIPS__`（每次动态取用），不是模块闭包：面板脚本被重新拉取后，旧 codec 仍能读到新实例写入的标注；本地没有该 id 时回退 `POST /pick`，因此「插入即消费」不会让已插入的 chip 变成「该标注已被清除」。

## 临时文件落点

插件不往代码仓写文件：浏览器 profile 与元素截图都在操作系统临时目录下。

- 根目录：`<os.tmpdir()>/dsh-visual-annotator`，可用环境变量 `DSH_VISUAL_ANNOTATOR_DIR` 覆盖。
- `/launch` 带上绝对 `cwd` 时，落点变为 `<根目录>/<项目名>-<cwd 的 sha1 前 8 位>/`：不同项目各自一份 `profile-<browser>/` 与 `shots/`，互不共享登录态、不互相覆盖 `p1.png`；同一项目重复打开复用同一目录（因此仍可接管已开窗口）。
- 不带 `cwd` 时直接用根目录，profile 跨启动留存。
- 计算逻辑在 `lib/shared/scratch-dir.js`（纯函数，已覆盖单测）。

## 一个 profile，多次调试

一个（项目 × 浏览器）对应一份 profile（`<落点>/profile-<browser>/`），浏览器实例跨多次 `/launch` 复用：

- 首次 `/launch` spawn 浏览器时，Chrome 会把实际调试端口写进该 profile 目录的 `DevToolsActivePort`；
- 之后的 `/launch` 先读这个文件，连上就在同一个实例里开新标签页（同地址用 `Target.activateTarget` 切过去），不 spawn、不重建 profile——所以登录态与已开的标签页都还在；`/state` 的 `resumed` 为 `true`；
- `/close` 缺省只断开 socket，窗口与 profile 保留（`/state.windowKept = true`）；下次 `/launch` 接回同一实例；
- `/close { terminate: true }` 才会 `Browser.close` 关窗；profile 不删。若当时没有活动 socket，会重连 `DevToolsActivePort` 再关，避免窗口留在桌面上关不掉；
- `DevToolsActivePort` 失效或实例已退出时回落：重新 spawn 同一个 profile。

**ego lite 是唯一会自动接管已运行实例的浏览器。** 它的 CDP 端口随机分配且没有端口文件，host 侧用 `pgrep -fl 'ego lite'` 找主进程（排除 `--type=` 子进程与自己的 pid），再用 `lsof -nP -F -iTCP -sTCP:LISTEN` 的整表输出取端口（宿主沙箱里 `ps`、`lsof -p <pid>` 会被拒，整表可以），逐个尝试 `/json/version` 接管；成功时 `/state.reused` 与 `resumed` 为 `true`、host 不持有进程，`/close { terminate: true }` 也只断开。接管后会把当前空间切到/新建名为 `agent 空间` 的 BrowserContext（`/state.spaceName`），并关掉 `chrome://onboarding/` 引导窗口。设 `DSH_VISUAL_ANNOTATOR_ADOPT_RUNNING=0` 关闭这条自动接管。

**Chrome / Edge 的外部连接是显式选项，不是默认行为。** 只有设了 `DSH_VISUAL_ANNOTATOR_CDP_URL`（可写 `host:port`，自动补 `http://`）才会去连它：`GET <base>/json/version`，只接受指向 `/devtools/browser/` 的 ws 端点（归一化与解析在 `lib/shared/cdp-endpoint.js` 纯函数里，已覆盖单测）。默认不探测任何常见端口——回环 9222 上很可能正是用户的日常 Chrome。连上外部实例后不创建 profile、不 spawn，`/state.reused` 为 `true`；`/close` 同样只断开，不会去关别人的窗口。

## 模块边界

见仓库根 `AGENTS.md` 的「仓库结构」与「硬性约束」。
