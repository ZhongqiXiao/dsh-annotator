# 20261110-1727-ce09-ai-native-门禁与自动化闭环改造: AI-Native 门禁与自动化闭环改造

- **Tags**: AI-Native, 门禁, 自动化, CI
- **Status**: doing · 2026-11-10 17:46:16 · @xzq · 5945a5b8-02da-4388-a6df-9998187717f1
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

<!-- Pitfalls and evidence: with revision + file:line or symbol names -->

## Conclusion

<!-- What got done, what got left behind -->

## Execution Log

<!-- Maintained by the script: appended by new / claim / set / release / log / close. Do not edit.
     Backfill with: progress log --id 20261110-1727-ce09-ai-native-门禁与自动化闭环改造 --note "...". -->
- 2026-11-10 17:27:45 · new · @xzq · 5945a5b8-02da-4388-a6df-9998187717f1 · created and claimed
- 2026-11-10 17:46:16 · log · @xzq · 5945a5b8-02da-4388-a6df-9998187717f1 · P0~P3 全部落地：三契约门禁+运行时门禁+canary 五场景演练+verify 串联+Stop hook+issue/PR 模板+CI 全历史与 e2e；npm run verify 全绿；自评成熟度 100/100（评分器本会话自建，存在自评偏置，首次真实拦截才算落地验证）
