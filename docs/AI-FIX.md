# AI-FIX：issue 自动派单与自动验证闭环

`ai-fix` 标签在本仓有双重含义：**agent-ready 契约**（issue 按模板把验收标准写成了可执行断言）+ **派单触发**（打上标签就自动开工）。

## 两条领取路径

1. **自动派单（Copilot coding agent）**：issue 打上 `ai-fix` 标签 → [`.github/workflows/ai-fix-dispatch.yml`](../.github/workflows/ai-fix-dispatch.yml) 通过 GraphQL 把 issue 指派给 Copilot → Copilot 开 `copilot/*` 分支并创建 Draft PR → PR 上跑 CI 的 `npm run verify`（含门禁 + canary）。
2. **本地 agent 认领**：任何编码 agent 会话执行 `gh issue list --label ai-fix` 找活，按模板验收标准修复，PR 用 `Resolves #N` 绑定 issue，合并即闭环。

## 一次性配置（三步）

```bash
# 1) 仓库启用 Copilot coding agent：Settings → Copilot → Coding agent（网页操作，需 Copilot Pro+）
# 2) 注册派单 token（需要 repo 权限、且账号有 Copilot 许可；GITHUB_TOKEN 无法指派 Copilot）
gh secret set COPILOT_ASSIGN_TOKEN --body "<ghp_xxx>"
# 3) 创建触发标签（bug 模板默认带它，但标签要在远端先存在）
gh label create ai-fix --description "Agent-ready: 验收标准即自动验证契约" --color 1D76DB
```

## 日常用法

```bash
gh issue create --label ai-fix --title "..." --body "..."   # 新建即派单
gh issue edit 42 --add-label ai-fix                        # 旧 issue 补派
gh pr list --search 'head:copilot/'                        # 看 Copilot 的 PR
gh pr checks <pr-number>                                   # 看 CI 验证结果
```

## 已知限制

- Copilot 被当作**外部贡献者**：PR 一律 Draft，**首次运行需要一次人工批准**（有写权限的人点 Approve to run），之后 CI 自动跑。
- issue 描述越精确产出越好；验收标准段尤其要写成可执行断言（模板里有示例）。
- Copilot 修完不等于验证通过：合并前看 CI `Verify` job 全绿，这也是本仓门禁存在的意义。

## 排障：派单没动静

按 2026-11-11 实测（issue #4）的两种失败形态逐条核对：

| 现象 | 判别方法 | 怎么修 |
| --- | --- | --- |
| workflow 报 `COPILOT_ASSIGN_TOKEN 未配置` | 仓库 secrets 里没有这一项 | `gh secret set COPILOT_ASSIGN_TOKEN --body <pat>`（PAT 要 repo 写权限） |
| workflow 报「assignableUsers 里没有 Copilot 机器人」 | `gh api graphql -H 'GraphQL-Features: issues_copilot_assignment_api_support' -f query='{repository(owner:"<owner>",name:"<repo>"){assignableUsers(first:20){nodes{__typename login}}}}'` 只回 `User`，没有 `Bot logincopilot-swe-agent` | 仓库 Settings → Copilot → Coding agent 打开（需要 Copilot Pro+ / Business；网页操作，没有 API） |
| 手动 `addAssigneesToAssignable` 返回 `assignees.nodes` 为空 | 同一个上面那条：mutation 接受但一个 assignee 不加 | 同上；另外 workflow 现在会核验 assignees 里真有 copilot，不再把「没派出去」报成成功 |

启用后在 issue 侧栏点 **Assign to Copilot** 也能直接开工（这条路径不需要 secret）；需要「打标签即派单」才配 secret。
