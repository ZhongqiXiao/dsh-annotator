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
