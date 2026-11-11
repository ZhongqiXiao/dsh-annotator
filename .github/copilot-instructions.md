# Copilot coding agent 指南（本仓）

本仓的完整约定在 [AGENTS.md](../AGENTS.md)；这里只放最容易被忽略、且会直接让 CI 变红的几条。

## 动手前后必做

```bash
npm install      # 新克隆先装 devDependencies
npm run verify   # 提交前必跑：check + lint + format:check + test + gates + canary
```

CI 的 `Verify` job 跑的就是 `npm run verify`；它红 = 你的改动还没完成。

## 会直接判红的硬约束

- **三契约同步**：改了 `lib/client.js` 必须同时递增 `lib/index.js` 的 `HOST_REV`（如 `v28-` → `v29-`）与 `lib/client.js` 的 `PANEL_BUILD`（同为 `v29`）；改了 `lib/overlay.js` 的注入载荷必须递增其中的 `var REV`。`scripts/check-build-sync.mjs` 用 git 历史校验，漏了必红。
- **双运行时**：`lib/client.js` 与 `lib/overlay.js` 的内嵌脚本跑在浏览器，禁止 Node API（`process`/`Buffer`/`node:` 模块）与 ESM `import`/`export` 语法。由 `scripts/check-embedded-runtime.mjs` 行级扫描强制。
- **包名即 Loader 名**：`package.json` 的 `name` 必须与 `cordis.patch.yml` 的 Loader name 一致，否则 Web 面板静默消失。

## 代码习惯

- 可单测的逻辑放 `lib/shared/` 并导出纯函数，`lib/session.js` 等只做薄委托；单测用 `node --test`，不启动真实浏览器。
- ESM、tab 缩进、单引号、行宽 120；不引第三方运行时依赖（只用 `node:` 内置模块）。
- 面向用户的字符串用中文；注释里的「为什么」要写清。

## 闭环

PR 正文写 `Resolves #<issue>`，合并即自动关闭 issue。合并前确认 CI 全绿——Copilot 修完不等于验证通过。
