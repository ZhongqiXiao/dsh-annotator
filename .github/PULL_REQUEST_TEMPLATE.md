## 关联 Issue

Resolves #

## 变更说明

<!-- 做了什么、为什么；若修 bug，注明触发缺陷的根因。 -->

## 验证

<!-- 贴 `npm run verify` 的结尾输出；必须全绿（含 gates 与 canary）。 -->

```

```

## 检查清单

- [ ] 改了 `lib/client.js`：HOST_REV（lib/index.js）与 PANEL_BUILD（lib/client.js）已同步递增，且 HOST_REV 引入提交晚于 client 最后改动
- [ ] 改了 `lib/overlay.js` 注入载荷：`var REV` 已递增
- [ ] `npm run verify` 全绿
- [ ] 四个必需检查全绿：`Verify` / `Scorer mutation test` / `Browser e2e` / `Plugin manifest integrity` 全部 success（main 分支保护要求）
- [ ] 分支已与 main 同步（保护规则是 strict：落后时先合并 main 再重跑）
- [ ] 正文 `Resolves #N` 已填：`PR contract (Resolves #N)` 会检查这条，issue 只由合并自动关闭，不要提前手关（无关联 issue 的改动给 PR 打 `no-issue` 标签，并在正文说明原因）
