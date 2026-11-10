# 20261110-1727-ce09-ai-native-门禁与自动化闭环改造: AI-Native 门禁与自动化闭环改造

- **Tags**: AI-Native, 门禁, 自动化, CI
- **Status**: doing · 2026-11-10 17:59:44 · @xzq · 5945a5b8-02da-4388-a6df-9998187717f1
- **Created**: 2026-11-10 17:27:45 · @xzq · 5945a5b8-02da-4388-a6df-9998187717f1

<!-- Header lines are maintained by the script, fixed order: Tags → Status → Created → Sealed.
     The `- **Tags**: …` line is inserted at the top by new --tags; omitted when there are no tags
     (category goes to the ledger and history only, never into this document).
     The `- **Sealed**: …` line is appended on close. -->

## Background

2026-11-11 用户调研 /Users/zhongqi/huawei/code/clb-new 的 AI-Native 体系后说「建一个台账，并开始实施」。借鉴其三层结构（评分引擎 canary 实测、物理拦截门禁、issue→修复→验证闭环），把本仓最高频翻车点——AGENTS.md 写了但没有物理强制的硬约束——升级为可执行门禁，并搭 issue 自动修复自动验证的地基。

## To Do

- P0 门禁：lib/shared/host-rev.js 纯函数（HOST_REV / PANEL_BUILD / overlay REV 解析与历史递增规则）+ scripts/check-build-sync.mjs（git 历史校验：改 client.js 必须先 bump HOST_REV；改 overlay 载荷必须 bump REV）
- P0 门禁：lib/shared/embedded-runtime.js 纯函数（注入脚本运行时禁令扫描）+ scripts/check-embedded-runtime.mjs，扫描 lib/client.js 全文与 lib/overlay.js 的 OVERLAY_SCRIPT 载荷（require/module 是 ModuleLoader 惯用法，白名单放行）
- P0 评分：scripts/assess-ai-native.mjs（canary 实测每道门禁必须真判失败，输出成熟度分数与报告）
- 测试：test/host-rev.test.mjs、test/embedded-runtime.test.mjs（含 canary 负例夹具）
- P1：hooks/verify-before-finish.mjs（Stop Hook，跑 npm run verify，失败带 💡 修复指南）+ .claude/settings.json 注册
- P2：.github/ISSUE_TEMPLATE/bug.md（验收标准段 = 自动验证契约）+ PULL_REQUEST_TEMPLATE.md（Resolves # 契约）
- P3：ci.yml 增加 e2e job（continue-on-error）并接入新门禁
- AGENTS.md 增补门禁说明与 AI-Native 工作流；package.json verify 链接入新门禁；eslint 覆盖 scripts/*.mjs
- npm run verify 全绿 + 运行 assess-ai-native.mjs 出基线分

## Next

写 lib/shared/host-rev.js 与 test/host-rev.test.mjs（纯函数先行），node --test 验证后再写 scripts/check-build-sync.mjs。

## Process

- run_code 生成器里模板串转义反引号两次翻车（\\` 提前终止字面量）→ 一律用 String.fromCharCode(96) 拼夹具。
- canary 夹具正则多转义一层（生成器 \\\\d 落盘成 \\d 匹配不上真实内容）→ replaceOrThrow 以「替换未生效即抛错」兜底，杜绝假演练。
- canary 断言关键词用过英文 payload，中文报错是「载荷」→ 断言改用 violation code（overlay-without-bump）。
- hooks/verify-before-finish.mjs 初版残留引号 + 未导入 readFileSync（ReferenceError）→ node --check + stop_hook_active 冒烟验证后修复。
- prettier --write 把 bug.md / PR 模板重排导致 format:check 一次中断 → 重跑后 npm run verify 全绿（98 tests + gates + canary，EXIT=0）。
- 评分证据：scripts/canary-gates.mjs 5/5 场景真判失败（exit=1 且报错含预期 violation code）；两门禁真仓 EXIT=0。

## Conclusion

- 完成（P0）：lib/shared/host-rev.js（三契约解析与静态/历史校验纯函数）、lib/shared/embedded-runtime.js（注入脚本运行时扫描）、scripts/check-build-sync.mjs（静态 + git merge-base 历史门禁）、scripts/check-embedded-runtime.mjs、scripts/canary-gates.mjs（5 场景演练）、test/host-rev.test.mjs 与 test/embedded-runtime.test.mjs（11 测试）。
- 完成（P1）：hooks/verify-before-finish.mjs + .claude/settings.json 注册 Stop hook，收尾前强制 verify，失败带对号入座的修复指南。
- 完成（P2）：.github/ISSUE_TEMPLATE/bug.md（验收标准=自动验证契约，labels [bug, ai-fix]）+ config.yml（禁空白 issue）+ PULL_REQUEST_TEMPLATE.md（Resolves #N 闭环）。
- 完成（P3）：ci.yml checkout fetch-depth: 0、单步 npm run verify、e2e job continue-on-error。
- 配套：package.json（gates/canary/assess 脚本 + verify 串联 + check 覆盖新文件）、eslint scripts/hooks 块、.gitignore .scratch/、AGENTS.md 三契约与 AI-Native 章节、docs/ai-native-health-report.md。
- 评分：npm run assess 自评 100/100 Tier 1 · Exemplar（评分器本会话自建，存在自评偏置；首次在真实 PR 里拦下违规才算落地验证）。
- 遗留：改动未 git 提交（待用户过目后按 Conventional Commits 提交）；e2e 在 CI 的首次真实运行结果未知（continue-on-error 兜底）；评分权重为本仓裁剪版，可随实战调整。

## Execution Log

<!-- Maintained by the script: appended by new / claim / set / release / log / close. Do not edit.
     Backfill with: progress log --id 20261110-1727-ce09-ai-native-门禁与自动化闭环改造 --note "...". -->
- 2026-11-10 17:27:45 · new · @xzq · 5945a5b8-02da-4388-a6df-9998187717f1 · created and claimed
- 2026-11-10 17:46:16 · log · @xzq · 5945a5b8-02da-4388-a6df-9998187717f1 · P0~P3 全部落地：三契约门禁+运行时门禁+canary 五场景演练+verify 串联+Stop hook+issue/PR 模板+CI 全历史与 e2e；npm run verify 全绿；自评成熟度 100/100（评分器本会话自建，存在自评偏置，首次真实拦截才算落地验证）
- 2026-11-10 17:50:51 · log · @xzq · 5945a5b8-02da-4388-a6df-9998187717f1 · 实现已按 Conventional Commits 落库两笔（afac74a 门禁+canary+评分器+测试+接线；eccda09 收尾钩子+issue/PR 模板+CI+AGENTS+健康报告）；推送待用户执行（远端有新提交需先 pull --rebase）；工作区遗留无关变更 assets/icon-180.png、scripts/make-icon.py 与未跟踪 .pnpm-store/、pnpm-lock.yaml 未纳入提交
- 2026-11-10 17:59:44 · log · @xzq · 5945a5b8-02da-4388-a6df-9998187717f1 · ai-fix 闭环补全：ai-fix-dispatch.yml 打标签即派 Copilot（assignCopilotToAssignable）+ docs/AI-FIX.md 配置文档 + AGENTS.md 领取协议，提交 0920439；期间另一会话并行落地 3c019c7 改名 dsh-annotator（cordis 同步改齐）且 canary-gates.mjs 有在途升级未完成，未触碰他人文件
