---
name: Bug 报告（AI 可修复）
about: 缺陷报告——验收标准写成可执行断言，供编码 agent 认领后自动修复并自动验证
labels:
  - bug
  - ai-fix
---

## 现象

<!-- 一句话说清哪里不对。提示：可用 DSH visual-annotator 拾取出错元素，把 selector / 页面 URL / 截图 / 评论直接贴进来，比文字描述更可复现。 -->

## 复现步骤

1.
2.

## 实际行为 / 期望行为

- 实际：
- 期望：

## 环境

- DSH 版本：
- 浏览器：
- 相关文件：

## 验收标准（AC，自动验证契约）

<!-- 修复 agent 将逐条执行以下断言来判定"修好了"；请写成可执行命令 + 期望输出，不要写主观描述。 -->

- [ ] `npm run verify` 全绿（含 gates 与 canary）
- [ ]

## 给修复 agent 的提示

- 认领方式：从本 issue 建 PR，正文写 `Resolves #<本 issue 编号>`，合并即闭环。
- 改 `lib/client.js` 必须同时递增 `lib/index.js` 的 HOST_REV 与 `lib/client.js` 的 PANEL_BUILD（两处数字一致）。
- 改 `lib/overlay.js` 注入载荷必须递增其中的 `var REV`。
- 注入脚本（client.js 与 OVERLAY_SCRIPT 载荷）只能用浏览器运行时，禁 ESM import/export 与 Node API；门禁会拦截。
- 收尾前 `npm run verify` 必须全绿；收尾钩子（Stop hook）会拦截未验证的会话。
