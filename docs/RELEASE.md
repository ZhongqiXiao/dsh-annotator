# 发版与自动化发布（GitHub Release / npm / 插件市场）

本文是发版流程的唯一权威说明，面向人类维护者与 AI agent。agent 想要发版时，照「一条龙命令」一节执行即可，无需再问流程。

## 总览：推一个 tag，三件事全自动

发版只由一件事触发：**把 `v<版本>` tag 推到 GitHub**。`.github/workflows/release.yml` 接手后续全部：

| 步骤    | 做什么                                                                                                                                                                                                                                | 失败条件                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| guard   | 校验 tag 名 `v<版本>` 与 `package.json` 的 `version` 完全一致                                                                                                                                                                         | 两者不一致，流程立刻失败            |
| check   | `npm install` + `npm run verify`（check/lint/format/test）+ 校验 `cordis.patch.yml` 含包名                                                                                                                                            | 任一门径失败                        |
| publish | `npm pack` 产出两份字节一致的 tarball（带版本名 + 无版本名 `dsh-annotator.tgz`（另附旧名 `dsh-visual-annotator.tgz` 兼容副本，官方市场旧链接继续可用））→ 建 GitHub Release 并上传资产 → 实际下载一次验证市场链接可用 → `npm publish` | pack 缺文件、资产缺失、npm 凭据问题 |

无版本名资产是给插件市场用的：市场条目写死 `releases/latest/download/dsh-annotator.tgz`，CI 每次发版重新生成它并**真的下载一次**验证不 404（见 workflow 里 "Verify market tarball is reachable" 一步）。

## 一条龙命令（agent 可照抄）

```sh
# 1. 版本号 + 变更记录（version 字段、package-lock、CHANGELOG 一起动）
npm version 0.5.4 --no-git-tag-version
# 然后把 CHANGELOG.md 的 ## [Unreleased] 改成 ## [0.5.4] - <日期>

# 2. 提交（发版提交用 chore(release)）
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): v0.5.4"

# 3. 打 tag 并推送
git tag v0.5.4
GIT_TERMINAL_PROMPT=0 git push origin main
GIT_TERMINAL_PROMPT=0 git push origin v0.5.4   # 轻量 tag 不会被 --follow-tags 带走，必须单独推
```

推完用 `gh run list --workflow=release.yml --limit 1` 看 CI，`gh release view v0.5.4` 看 Release。三站验证（GitHub Release 资产 / npm registry / 市场条目 tarball 链接）全在 CI 里做，绿了就是发完了。

## 前提（一次性配置，均已就绪）

| 依赖                  | 状态      | 说明                                                                                                                                |
| --------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `NPM_TOKEN` secret    | ✅ 已配置 | 仓库 Settings → Secrets and variables → Actions；是 npmjs 的发布令牌。缺失时 CI 只跳过 npm 发布（warning），GitHub Release 仍会产出 |
| `GITHUB_TOKEN`        | ✅ 自带   | workflow `permissions: contents: write`，建 Release / 传资产用                                                                      |
| 插件市场条目          | ✅ 已收录 | `awesome-dsh-plugin` 仓库 `data/plugins/ZhongqiXiao__dsh-visual-annotator.yml`；仓库已加 `dsh-plugin` topic                         |
| `dsh.bundle` manifest | ✅        | `package.json` + `cordis.patch.yml`，市场收录与 `dsh plugin add` 的前提                                                             |

## 插件市场为什么不用每次发版都动

市场条目不是快照，是**指针**：

- 条目的 `tarball` 指向 `releases/latest/download/<无版本名>.tgz` —— 每次发版 CI 都会重制这份资产并验证可下载，市场装到的永远是最新的包。
- [dsh-plugin.org](https://dsh-plugin.org/) 每天抓取收录仓库与 npm 的新版本，条目文案不变、版本自动跟上。
- 所以**只有首次收录才需要发 PR**（往 `awesome-dsh-plugin` 加一个 `data/plugins/<owner>__<repo>.yml`，格式见它的 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)）；条目文案要改（比如描述变了）也走同一个 PR 流程，只改自己那一个文件。

## 常见故障

- **guard 失败**：tag 与 `package.json` 版本不一致。删 tag 重打：`git tag -d v0.5.4 && git push origin :refs/tags/v0.5.4`，修好版本号后重打重推。
- **忘了单独推 tag**：`--follow-tags` 只带 annotated tag，本仓库用的是轻量 tag，所以第 3 步两条 push 缺一不可。
- **CI 里 npm 发布被跳过**：日志出现 `NPM_TOKEN secret not configured` —— 去仓库 Settings 配好 secret 后 `gh run rerun <run-id>` 重跑（Release 步骤对已存在的 Release 用 `--clobber` 补传资产，重跑安全）。
- **npm 上已有同名版本**（403 already published）：说明版本号没递增，回到第 1 步换新版本号。

## 本机不走 CI 的兜底（一般不需要）

CI 挂了又急着发时，本机也可以直接发，但要求本机 `npm login` 过（registry 必须是 npmjs，npmmirror 是只读镜像）：

```sh
npm publish --registry=https://registry.npmjs.org/
```

沙箱环境注意 `NPM_CONFIG_CACHE` 与 `NPM_CONFIG_LOGS_DIR` 要指到可写目录，否则 npm 写 `~/.npm` 失败。
