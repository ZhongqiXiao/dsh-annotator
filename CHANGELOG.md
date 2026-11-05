# 更新日志

本文件记录 dsh-visual-annotator 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

暂无。

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
