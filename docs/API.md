# 插件 API 契约

## HTTP 路由（均挂 `/api/visual-annotator`，v4+ 需 DSH GUI 凭据）

| 方法 | 路径        | 作用                                                                           |
| ---- | ----------- | ------------------------------------------------------------------------------ |
| GET  | `/state`    | 面板状态轮询：`{ ok, rev, mode, url, title, tabs[], picks[], activeTargetId }` |
| POST | `/launch`   | 启动/接管浏览器，`{ browser?: 'chrome'\|'edge', url? }`                        |
| POST | `/probe`    | 探测可用浏览器                                                                 |
| POST | `/mode`     | 切换拾取层模式 `{ mode }`                                                      |
| POST | `/navigate` | 当前 Tab 跳转 `{ url }`                                                        |
| POST | `/tab`      | 切换活动 Tab `{ targetId }`                                                    |
| POST | `/comment`  | 写入某标注评论 `{ id, comment }`                                               |
| POST | `/remove`   | 删除标注 `{ id }`（截图文件延迟释放，供 `/restore` 撤销）                      |
| POST | `/restore`  | 撤销最近一次删除，返回 `{ ok, restored, ...snapshot }`                         |
| POST | `/focus`    | 在浏览器中定位某标注 `{ id }`，返回 `{ ok, focused, ...snapshot }`             |
| POST | `/clear`    | 清空全部标注                                                                   |
| POST | `/close`    | 关闭调试浏览器                                                                 |
| GET  | `/shot?id=` | 取某标注截图 PNG                                                               |

## Agent 工具

- **`visual_annotator_read`**：读取标注列表，参数 `ids?: number[]`（id 过滤）、`shots?: 'none'\|'all'\|number`（截图附件数，默认最新 3 张）。
- 插入到 composer 的引用格式：`[标注 #<id>] <评论> ｜ <定位行>`；agent 看到该标记时应调用 `visual_annotator_read`（可带 `ids`）换取完整 selector/URL/坐标/截图。
- composer 内的 chip 由 GUI reference source `visual-picker` 注册（`lib/client.js` ensureVpSource），提交时由 `serializeReference` 展开为完整定位文本；chip 失败时回退纯文本插入。

## 模块边界

见仓库根 `AGENTS.md` 的「仓库结构」与「硬性约束」。
