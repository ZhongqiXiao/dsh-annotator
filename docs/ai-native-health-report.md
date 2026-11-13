# AI-Native 健康报告

> 由 scripts/assess-ai-native.mjs 生成于 2026-11-12

```
AI-Native 成熟度：100/100（Tier 1 · Exemplar）
证据结构：执行型 24/24（真跑进程取证）｜文本型 76/76（仅文本存在性）
⚠ 文本项满分上限 76 分，只堆关键词也能到 Tier 3/2——所以 Tier 1 额外要求执行型探针全绿。
治理与文档  15/15
物理拦截  25/25
架构边界  15/15
契约同步  15/15
工作流自动化  20/20
验证与测试  10/10

待改进项：
- 无
```

## 逐项明细

## 治理与文档（15/15）

| 项目 | 证据类型 | 结果 |
|---|---|---|
| AGENTS.md 存在且非空 | text | ✅ 3/3 |
| HOST_REV / PANEL_BUILD / overlay REV 三契约写明 | text | ✅ 4/4 |
| 双运行时约束写明 | text | ✅ 4/4 |
| 提交与发版规范写明 | text | ✅ 4/4 |

## 物理拦截（25/25）

| 项目 | 证据类型 | 结果 |
|---|---|---|
| build-sync 门禁存在 | text | ✅ 1/1 |
| embedded-runtime 门禁存在 | text | ✅ 1/1 |
| npm run verify 串联门禁与 canary | text | ✅ 3/3 |
| canary 阳性实跑通过（注入违规必须真被拦，实测 7 例） | exec | ✅ 4/4 |
| canary 阴性对照实跑通过（干净夹具必须放行，实测 5 例） | exec | ✅ 3/3 |
| CI 跑 verify 且 fetch-depth: 0（历史规则在 CI 真生效） | text | ✅ 5/5 |
| 浅克隆在 CI 直接判红（堵死「警告放行」假绿路径） | text | ✅ 4/4 |
| canary 对「门禁被桩化」必须变红（哨兵探针） | exec | ✅ 4/4 |

## 架构边界（15/15）

| 项目 | 证据类型 | 结果 |
|---|---|---|
| lib/shared/ 存放纯函数模块 | text | ✅ 5/5 |
| host 代码复用 shared 模块 | text | ✅ 5/5 |
| 两道扫描门禁在真仓实跑通过 | exec | ✅ 5/5 |

## 契约同步（15/15）

| 项目 | 证据类型 | 结果 |
|---|---|---|
| 三契约（HOST_REV/PANEL_BUILD/overlay REV）由门禁覆盖 | text | ✅ 5/5 |
| git 历史递增规则启用 | text | ✅ 5/5 |
| canary 双向覆盖（阳性≥5 且阴性≥3） | text | ✅ 5/5 |

## 工作流自动化（20/20）

| 项目 | 证据类型 | 结果 |
|---|---|---|
| verify-before-finish 收尾钩子存在 | text | ✅ 2/2 |
| 钩子已注册（Stop hook） | text | ✅ 2/2 |
| 收尾钩子 guard 放行实跑（stop_hook_active 防死循环） | exec | ✅ 2/2 |
| 收尾钩子失败方向实跑拦截（verify 红必须拦，实测 exit=1） | exec | ✅ 4/4 |
| bug 模板验收标准段含可执行断言（代码块/复选项/命令） | text | ✅ 4/4 |
| bug 模板带 ai-fix 触发标签 | text | ✅ 2/2 |
| PR 模板绑定 Resolves #issue | text | ✅ 2/2 |
| 合入闸门体检器能检出「必需检查被改名」（实测 干净夹具=0 改名后=1） | exec | ✅ 2/2 |

## 验证与测试（10/10）

| 项目 | 证据类型 | 结果 |
|---|---|---|
| verify 链包含测试 | text | ✅ 3/3 |
| CI 运行测试 | text | ✅ 3/3 |
| e2e 进 CI 且是真门禁（失败不会被吞） | text | ✅ 4/4 |
