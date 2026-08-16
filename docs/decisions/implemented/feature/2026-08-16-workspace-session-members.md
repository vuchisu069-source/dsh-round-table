# 2026-08-16 — 工作区会话成员（混合房间）功能决策

**分类**：feature
**状态**：implemented

## 背景

用户提出：除自建 agent 角色外，让工作区既有的对话框（真实会话）也能被拉入圆桌参与讨论，
消除多个 AI 对话框之间的"信息隔离"——这是产品最初的核心理痛。

## 决策

1. **成员两态并存**：房间成员 `kind: 'role' | 'session'`。role = 插件自建 agent（人设经注入消息合成）；
   session = 工作区既有会话（`member.sessionId` 指向宿主会话，`title` 快照展示），以它自己的上下文参与。
2. **驱动对齐官方 session.prompt 模式**（dsh-host-apiproxy / dsh-api-remotes 实证）：
   live agent（`ctx.agents.get`）优先；冷会话 `ctx.agents.resume({ resumeSessionId })`；role 成员
   `ctx.agents.create({ id, sessionId, provider, model })`（模型取自 settings 的 `agent-default-model`，
   对齐 D1 统一模型）。
3. **消息注入**：`agent.followup(buildUserMessage(...))`（队列模式，不打断该会话自身回合）；
   回复经 `session/event` 的 `turn/end` 回读 `assistant/message` 文本，写入时间线并推进队列。
4. **零 @deepseek-ai 依赖的消息构造**：不 import `@deepseek-ai/dsh-llm` 的 `createUserMessage`，
   手工构造 `{ role, id, content, source: {kind:'user', rpcId} }`（对齐 dsh-session 的
   `assertMessageEventShape` 校验）。原因：官方包由 profile pnpm 闭包注入，本地 `link:`/`file:` 安装
   为符号链接，realpath 落在工作区 → `@deepseek-ai/*` 解析失败（实测 ERR_MODULE_NOT_FOUND）。
   零依赖构造保证任何安装方式可解析。
5. **错误与兜底**：resume 失败 → 落失败消息跳过；LLM 错误（turn/end reason error/aborted）→ 落失败消息；
   120s 超时强制结算；subagent-owned 会话 → 报错跳过。

## 验证

- 结构验证（沙箱 3098 端口，无凭据）：混合房间组建、2 轮自动停止、role 成员完整驱动管线
  （create → followup → turn/end 捕获 → 记账 → 推进）跑通（LLM 调用失败路径符合预期）；
  session 成员 resume 失败路径符合预期。
- 真实 LLM 回复文本捕获需在有凭据的环境实测（下一步）。

## 已知限制

- 同一会话被多房间并发驱动：followup 队列模式排队，捕获按 pending 归属，极端并发下可能串回合（记录待 v2 处理）。
- session 成员发言注入的 prompt 不含角色卡（会话自身上下文即人设），符合设计意图。
