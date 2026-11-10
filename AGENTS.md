# AGENTS.md

本文件面向在此仓库工作的 AI 编码代理与人类贡献者。改动前请先阅读；提交前请跑通门径（见下）。

## 仓库结构

```
lib/
  index.js    host 入口（DSH cordis 插件 apply(ctx)），HTTP 路由 + agent 工具 visual_annotator_read
  session.js  VisualPicker：CDP 驱动可见 Chrome/Edge，拾取状态与截图落盘
  cdp.js      CDP 连接层（CdpPipe / CdpWs）
  overlay.js  注入页面的拾取层脚本（shadow DOM）+ 绑定名常量
  client.js   Web 面板脚本（跑在 DSH GUI 浏览器环境，sourceType: script）
  shared/     host 与未来复用方的纯函数模块（无副作用）
test/         单元测试（纯函数，不启动浏览器）+ e2e-browsers.test.mjs（真浏览器，默认 skip）
.github/workflows/  ci.yml（PR/push 门径）、release.yml（tag v* 发布）
```

## 硬性约束（改动前必读）

- **包名即 Loader 名**：`package.json` 的 `name` 必须与 `cordis.patch.yml` 里的 Loader name 一致，否则 Web 面板静默消失。
- **HOST_REV**：`lib/index.js` 的 `HOST_REV`（形如 `v7-`）每次改动 `lib/client.js` 后必须递增前缀数字，GUI 靠它判断是否强拉新面板脚本。
- **双运行时**：`lib/client.js` 与 `lib/overlay.js` 内嵌脚本跑在浏览器（不能用 Node API / ESM import 语法在注入脚本里）；`lib/index.js`、`lib/session.js`、`lib/cdp.js`、`lib/shared/` 跑在 Node 22 host。
- **host 侧改动需重启 DSH Desktop 生效**；client 侧改动靠 HOST_REV 强刷。
- **路由鉴权**：v4 起 `/api/visual-annotator/*` 走 DSH 凭据守卫（requestRejection），外部 curl 401 属预期，不要“修复”它。
- **纯函数下沉**：可单测的逻辑放 `lib/shared/` 并导出；`session.js` 里的方法尽量变成对 shared 纯函数的薄委托。

## 命令

```bash
npm run verify   # check（node --check 全部 lib）+ lint（eslint）+ test（node --test）——提交前必跑
npm run format   # prettier 全量格式化
npm run lint:fix # eslint 自动修复
npm test         # 只跑单元测试
npm run test:e2e # 真浏览器端到端（无头 + --no-sandbox），装了哪个浏览器就跑哪个
```

## 代码规范

- ESM（`"type": "module"`），tab 缩进，单引号，行宽 120（见 `.editorconfig` / `.prettierrc.json`）。
- host 代码用 Node 内置模块（`node:` 前缀），不引第三方运行时依赖；devDependencies 仅限 lint/test 工具。
- 面向用户的字符串用中文；日志/注释可中英混用，但原因解释必须写清「为什么」。

## 提交与发布

- Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:`）。
- 发版：改 `package.json` version + 在 `CHANGELOG.md` 记录 → 提交 → 打 `v*` tag 推送，CI 自动出 GitHub Release（tag 与 package.json 版本不一致会 guard 失败）。
