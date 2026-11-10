# 贡献指南

面向想参与开发本插件的协作开发者。使用层面的问题（是什么、怎么装、怎么用）见 [README](README.md)。

## 插件架构

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

插件跑在**两个运行时**上，改代码前先分清：

- **Node 22 host**：`lib/index.js`、`lib/session.js`、`lib/cdp.js`、`lib/shared/`。host 通过 CDP（Chrome DevTools Protocol）驱动浏览器：`session.js` 负责拉起/接回浏览器实例、注入拾取层、收拾取事件、截图落盘；`index.js` 把能力暴露成 HTTP 路由和 agent 工具。
- **浏览器**：`lib/overlay.js` 与 `lib/client.js` 是内嵌脚本，分别注入目标页面（拾取层，shadow DOM，通过 `Page.addScriptToEvaluateOnNewDocument` + `Runtime.addBinding` 注入，不受页面 CSP 影响）和 DSH GUI 面板。这两个文件里**不能用 Node API，也不能用 ESM import 语法**。

数据流：页面 overlay 拾取元素 → binding 回传 host → host 记录并截图（截图落在 `<临时目录>/shots/`，路径随标注记录返回）→ 面板把标注打包成引用芯片插入 GUI 输入框 → agent 收到后用 `visual_annotator_read` 工具读回完整定位信息。

## 开发环境配置

1. 克隆本仓库，`npm install`。
2. 用「本地目录」方式把仓库挂进 DSH profile，见 [README · 方式 C](README.md#方式-c本地目录开发模式)。host 侧改动需重启 DSH Desktop 生效；面板脚本靠版本号（`lib/index.js` 的 `HOST_REV`）强刷，无需重启。
3. 改完跑门径（见下），绿了再提交。

### 常用命令

```bash
npm run verify    # check（node --check 全部 lib）+ lint（eslint）+ test（node --test）——提交前必跑
npm run format    # prettier 全量格式化
npm run lint:fix  # eslint 自动修复
npm test          # 只跑单元测试
npm run test:e2e  # 真浏览器端到端（无头 + --no-sandbox），装了哪个浏览器就跑哪个
```

### 测试

- 单元测试跑纯函数（`lib/shared/`），不启动浏览器。
- `npm run test:e2e` 对每个装了的浏览器各跑一遍「启动 → 拾取层注入 → 同址不重复开标签 → 新址开新标签 → 断开后接回同一实例」「调试空间 cookie 隔离 + 拾取层注入 + 关闭回默认」；装了 ego lite 再跑「接管已运行实例」，装了 ≥2 个再跑「换浏览器」。没装的浏览器自动跳过。用例默认带 `ADOPT_RUNNING=0`，不会跑到你日常开着的 ego 里。
- 用例用无头 + 临时 profile，不需要额外开关。宿主沙箱会拦住 Chrome 自己的 sandbox（renderer 报 `SIGTRAP`、日志出现 `chrome connection is closed`），插件识别到「自己起的实例刚死」后带 `--no-sandbox` 自动重试一次，快照里 `sandboxFallback` 变为 `true`。这条回退只作用于**自己 spawn** 的进程，接回的外部窗口不受影响；设 `DSH_VISUAL_ANNOTATOR_SANDBOX_FALLBACK=0` 可关闭。

## 硬性约束（改动前必读）

- **包名即 Loader 名**：`package.json` 的 `name` 必须与 `cordis.patch.yml` 里的 Loader name 一致，否则 Web 面板静默消失。
- **HOST_REV**：`lib/index.js` 的 `HOST_REV`（形如 `v7-`）每次改动 `lib/client.js` 后必须递增前缀数字，GUI 靠它判断是否强拉新面板脚本。
- **双运行时**：`lib/client.js` 与 `lib/overlay.js` 内嵌脚本跑在浏览器（不能用 Node API / ESM import 语法）；其余 `lib/` 跑在 Node 22 host。
- **host 侧改动需重启 DSH Desktop 生效**；client 侧改动靠 HOST_REV 强刷。
- **路由鉴权**：`/api/visual-annotator/*` 走 DSH 凭据守卫（requestRejection），外部 curl 返回 401 属预期，不要“修复”它。
- **纯函数下沉**：可单测的逻辑放 `lib/shared/` 并导出；`session.js` 里的方法尽量变成对 shared 纯函数的薄委托。

## 代码规范

- ESM（`"type": "module"`），tab 缩进，单引号，行宽 120（见 `.editorconfig` / `.prettierrc.json`）。
- host 代码只用 Node 内置模块（`node:` 前缀），不引第三方运行时依赖；devDependencies 仅限 lint/test 工具。
- 面向用户的字符串用中文；日志/注释可中英混用，但原因解释必须写清「为什么」。
- 提交前跑 `npm run verify`；CI（`ci.yml`）在 PR/push 上强制执行同一套检查。

## 提交与发版

- 提交信息用 Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:`）。
- 发版是全自动的：打 `v*` tag 推送后，CI 校验 tag 与 `package.json` 版本一致、跑通门径，然后自动完成 GitHub Release、npm 发布和插件市场 tarball 更新。完整流程（一条龙命令、一次性前提、常见故障）见 [`docs/RELEASE.md`](docs/RELEASE.md)。
- 变更记录写在 [`CHANGELOG.md`](CHANGELOG.md)，格式参考 Keep a Changelog。

## 相关文档

- [`AGENTS.md`](AGENTS.md)：面向 AI 代理的协作约定（含任务台账规则），人也可以读。
- [`docs/API.md`](docs/API.md)：插件 HTTP 路由与 agent 工具的 API 契约。
- [`docs/RELEASE.md`](docs/RELEASE.md)：发版流程。
