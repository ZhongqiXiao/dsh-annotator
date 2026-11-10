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
scripts/      工程门禁与工具（build-sync / embedded-runtime / canary-gates / assess-ai-native）
hooks/        verify-before-finish.mjs 收尾钩子（未过 verify 不得收工）
.github/      workflows/（CI 门径）、ISSUE_TEMPLATE/（bug 模板带验收标准与 ai-fix 标签）、PR 模板（Resolves 闭环）
```

## 硬性约束（改动前必读）

- **包名即 Loader 名**：`package.json` 的 `name` 必须与 `cordis.patch.yml` 里的 Loader name 一致，否则 Web 面板静默消失。
- **三契约同步（物理门禁强制）**：`lib/index.js` 的 `HOST_REV`（形如 `v28-`）与 `lib/client.js` 的 `PANEL_BUILD`（形如 `v28`）两处数字必须一致，且每次改 `lib/client.js` 都要递增（GUI 靠 HOST_REV 判断是否强拉新面板脚本）；`lib/overlay.js` 注入载荷内的 `var REV` 每次改载荷必须递增（同 REV 的旧实例会走 reattach 分支，新逻辑不会生效）。以上由 `scripts/check-build-sync.mjs` 用 git 历史强制校验：client 最后改动提交必须早于当前 HOST_REV 的引入提交，载荷改动必须早于当前 REV 的引入提交，违者 CI 与收尾钩子直接红。
- **双运行时**：`lib/client.js` 与 `lib/overlay.js` 内嵌脚本跑在浏览器（不能用 Node API / ESM import 语法在注入脚本里）；`lib/index.js`、`lib/session.js`、`lib/cdp.js`、`lib/shared/` 跑在 Node 22 host。此约束由 `scripts/check-embedded-runtime.mjs` 行级扫描强制，违规带行号与修复指南报出。
- **host 侧改动需重启 DSH Desktop 生效**；client 侧改动靠 HOST_REV 强刷。
- **路由鉴权**：v4 起 `/api/visual-annotator/*` 走 DSH 凭据守卫（requestRejection），外部 curl 401 属预期，不要“修复”它。
- **纯函数下沉**：可单测的逻辑放 `lib/shared/` 并导出；`session.js` 里的方法尽量变成对 shared 纯函数的薄委托。

## 命令

```bash
npm run verify   # check + lint + format:check + test + gates + canary——提交前必跑，全绿才算过门径
npm run gates    # 只跑两道物理门禁（build-sync 三契约 / embedded-runtime 运行时约束）
npm run canary   # canary 演练（双向对照 12 场景）：阳性=违规必须拦、阴性=干净必须放行、CI 浅克隆必须红、评分器自证
npm run assess   # AI-Native 成熟度评分（--write-docs 写入 docs/ai-native-health-report.md）
npm run assess:gate # 评分地板分（--min-score 80）：低于地板分 exit 1，CI 强制——评分器不许自己永远 exit 0
npm run mutate   # 评分器的评分器：克隆本仓打坏 15 个控制项，断言分数必须逐个下降（检不出的变异 = 判据在骗人）
npm run format   # prettier 全量格式化
npm run lint:fix # eslint 自动修复
npm test         # 只跑单元测试
npm run test:e2e # 真浏览器端到端（无头 + --no-sandbox），装了哪个浏览器就跑哪个
```

## 代码规范

- ESM（`"type": "module"`），tab 缩进，单引号，行宽 120（见 `.editorconfig` / `.prettierrc.json`）。
- host 代码用 Node 内置模块（`node:` 前缀），不引第三方运行时依赖；devDependencies 仅限 lint/test 工具。
- 面向用户的字符串用中文；日志/注释可中英混用，但原因解释必须写清「为什么」。

## AI-Native 门禁与自动化闭环

- **物理拦截优先于文档约定**：「写在这但没人查」的约束必然翻车。本仓把最容易翻车的两类契约（三版本标记、注入脚本运行时）做成了物理门禁（`scripts/check-build-sync.mjs`、`scripts/check-embedded-runtime.mjs`），CI 与收尾钩子都会跑。
- **canary 双向自证**：`npm run canary` 共 12 场景，假门禁的三种死法各配探针——永远 exit 0 的门禁（阳性 5：版本 skew、process 泄漏、载荷 require、漏递增的 client/载荷，注入违规必须真判失败）；永远 exit 1 的门禁（阴性 4：干净夹具 ×2、同提交递增、浅克隆本地放行，必须全部放行）；CI 假绿路径（浅克隆 + CI 环境必须直接红，堵死「警告放行」）；永远 exit 0 的评分器（自证 2：`--min-score 101` 必须红、0 必须绿）。任何一类失效，canary 都会红。
- **收尾钩子**：agent 会话收尾前自动执行 `npm run verify`（`hooks/verify-before-finish.mjs`，注册于 `.claude/settings.json` 的 Stop hook），未全绿会被拦下并给出对号入座的修复指南。
- **issue → 修复 → 验证闭环**：bug 模板（`.github/ISSUE_TEMPLATE/bug.md`）要求验收标准写成可执行断言（这是自动验证契约）。`ai-fix` 标签 = agent-ready 契约 + 派单触发，两条领取路径：
  - **自动派单**：打上 `ai-fix` 标签后，`.github/workflows/ai-fix-dispatch.yml` 把 issue 指派给 GitHub Copilot coding agent，由它开分支、开 Draft PR；首个 PR 需人工批准一次，之后 CI verify 自动验证。一次性配置见 [docs/AI-FIX.md](docs/AI-FIX.md)。
  - **本地认领**：编码 agent 会话执行 `gh issue list --label ai-fix` 认领，按验收标准修复，PR 用 `Resolves #N` 绑定 issue，合并即闭环。
- **成熟度评分**：`npm run assess` 按 6 维（治理 15 / 物理拦截 25 / 架构边界 15 / 契约同步 15 / 工作流自动化 20 / 验证测试 10）实跑取证评分，≥90 Exemplar、≥75 AI-Ready；报告落 `docs/ai-native-health-report.md`。CI 在 verify 后另跑 `npm run assess:gate`（--min-score 80），低于地板分直接红。
- **证据分级（评分不是一个人说了算）**：评分项分两级——`exec` 真跑进程看退出码（门禁、canary、收尾钩子的正向+失败方向、哨兵探针），`text` 只读文本存在性（AGENTS.md 关键词、模板段落、CI 配置行）。报告显式分列两者；文本项堆满最多 78 分，所以 **Tier 1 额外要求执行型探针全绿**。别把 100 分当成「质量已被证明」，它只说明「配置面齐备 + 可执行面全绿」。
- **变异测试（`npm run mutate`）**：克隆本仓，逐个打坏控制项（删 AGENTS.md、桩化门禁、桩化 canary、钩子改成无条件放行、抹掉地板分……共 15 个），断言评分必须下降。这条是评分器自己的 canary：判据一旦退化成「读关键词」，变异就会存活，命令直接红。

## 任务台账

任务进度、工作事项与工作日志统一交给 `task-ledger` skill（DSH 的 dsh-task-ledger）管理，不在仓库里另建清单：

- **一律走台账**：凡任务进度、工作事项与工作日志（新建 / 推进 / 查询 / 结案）一律调用 `task-ledger` skill 管理；进度 / 历史类问题一律走它作答，不凭对话记忆或自建清单顶替。
- **开工锚点**：仅当用户明确说要新建（如「开个新坑」「先记一下」「建个任务」）才交给 `task-ledger` 登记；提问 / 查询 / 讨论 / 顺手小改不算，拿不准先问，未经用户明确指令不得擅自新建任务。
- **顺手问一句**：用户在推进一件跨轮的事（这轮答完、手上还有下一步动作没做完）、却从没提过记账时，答完问一次「你现在这个任务是需要帮你建一个台账吗？（如果无需，忽略这句话，也不用去回复。）」；本会话问过一次就别再问，无回复就忽略。

## 提交与发布

- Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:`）。
- 发版：改 `package.json` version + 在 `CHANGELOG.md` 记录 → 提交 → 打 `v*` tag 推送，CI 自动出 GitHub Release（tag 与 package.json 版本不一致会 guard 失败）。
- **发版全流程看 [docs/RELEASE.md](docs/RELEASE.md)**（agent 发版照它执行）：推 tag 后 CI 自动完成 GitHub Release + npm publish + 插件市场 tarball 更新（一条龙命令、前提、常见故障都在里面，插件市场已收录、发版无需再动它）。
