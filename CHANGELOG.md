# 更新日志

本文件记录 dsh-visual-annotator 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### Added

- **商店图标**：新增 `assets/icon-180.png`（180×180，市场卡片用的 GitHub 托管位图）与可复现的生成脚本 `scripts/make-icon.py`；图标由 Pillow 4 倍超采样后降采样得到，无需设计源文件。

### Changed

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
