# 2026-08-16 — 冷会话 resume 必须带 agentOptions（环境事实）

**分类**：bug-fix
**状态**：implemented

## 现象

会话成员（工作区既有对话框）拉入房间后发言失败，会话日志报：

```
prompt variable "{{model}}" has no value for this assembly (section "deployment:persona")
```

角色成员此前也踩过同坑（`ctx.agents.create` 的 provider/model 未放入 `agentOptions`）。

## 根因（环境事实）

`ctx.agents.resume({ resumeSessionId })` 不带 `agentOptions` 时，loop 的 options 里没有
provider/model → systemPrompt 组装阶段 `{{model}}`/`{{provider}}` 变量无值 → turn 以 error 结束。
官方 `dsh-host-apiproxy` 的 `agentFor`/`session.prompt` 在 create/resume 时一律传
`agentOptions: defaults.defaultModelSelection()`（即 agent-default-model 的 provider/model）——
**这是官方契约，不是可选项**。会话自身的模型选择仍由 request/header 驱动实际调用，
agentOptions 只满足 prompt 组装。

## 修复

- `roleAgent`：`ctx.agents.create({ sessionId, agentOptions: {provider, model}, meta: {cwd} })`
- `sessionAgent`：`ctx.agents.resume({ resumeSessionId, agentOptions: {provider, model} })`
- 默认模型来源：`settings.get('agent-default-model')`

## 验证

- 角色成员：2 轮 × 3 成员真实 LLM 讨论收敛（模拟评审场景）
- 会话成员：真实对话框（dsh-plugin-market 安装会话）resume 后用自己的上下文作答，回复含
  其对 DSH 内置 `session-log-export` 的认知——「信息隔离消除」路径全链路验证通过

## 附属

- `/members` 增加空 sessionId 校验（测试脚本误传空串暴露：resume('') 报
  `cannot encode an empty path segment`）
- 会话标题兜底（header.title → 首条用户消息 → 时间 → id）已入 `lib/src/titles.mjs`
