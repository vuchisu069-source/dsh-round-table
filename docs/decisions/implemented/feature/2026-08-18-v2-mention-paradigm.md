# 决策：v2 @ 提及范式（取代 v1/D6 房间范式）

- **日期**：2026-08-18
- **状态**：implemented（已实现并端到端验证）

## 背景

v1（D6）实现为"房间"范式：左栏角色库 + 中心区时间线 + 右栏活动/控制，用户创建房间、
拉角色进房间、在房间面板内讨论。用户评估后决定**大改**：

> 右侧圆桌活动直接全部砍掉，保留左下方创建角色；创建房间去掉。
> 使用逻辑：创建角色后，在 DSH 主对话输入框 @ 出来；@ 两个角色可互相讨论一件事，
> 讨论次数只为一轮，防止无限循环。

## 决策

1. **@ 范式**：角色直接在 DSH 主对话中被 `@角色名` 召唤，不再有房间/面板。
2. **单角色**：主会话以该角色身份回答（system-prompt 注入角色卡）。
3. **多角色真讨论**：每个角色**独立 Agent 会话**串行接力（A 输出作为 B 上下文），仅一轮；
   主持人收敛出共识/分歧/行动建议。
4. **成本护栏**：多角色协调等待阶段 tools 清空（防 Deep diving）；SOUL 2000 字截断；
   90s/角色 + 120s 整体超时。
5. **工具放开（用户决策 2026-08-18）**：单角色 @ 与角色独立会话放开宿主工具（角色能读代码干活）；
   多角色主会话等待阶段仍无工具。

## 关键 API 探明结论（对后续开发者最重要）

| 结论 | 说明 |
|---|---|
| `ctx.inputTriggers.registerSource` | 浏览器端注册 `@` 候选源（官方输入管线）；candidate 的 `icon` 是**纯文本**（React children 渲染），传 SVG data-URI 会显示乱码 → 用 emoji |
| `system-prompt/assemble`（waterfall） | `AssembleContext.scope` 即 **agent 对象**（dsh-agent `assembleContextFor` 里 `scope: agent`）；`agent.id`=SessionId、`agent.session.events` 可直读；可修改 `assembly.sections` / `assembly.tools`，返回 next() |
| assemble 时读 session.events 拿不到用户消息 | 实测读到的是 "Current runtime context" 快照；**必须**从 `session/event` 的 user/message 事件（`eventUserText`）提取并缓存 |
| `ctx.agents` 需声明 inject | `inject: ['agents', ...]`，否则 `cannot get property "agents" without inject` |
| 角色会话复用 | `ctx.agents.create` 对**已存在 sessionId** 会空转（turn 0.015s 即 end 无输出）；已持久化会话须用 `ctx.agents.resume({ resumeSessionId })`，不存在才 create |
| 纯文本护栏 | prompt 指令不可靠（模型会无视"只回一句话"）；**清空 `assembly.tools` 才是硬护栏**（模型无工具则无法 Deep diving） |
| `@角色名` 解析 | 正则需 lookbehind 排除邮箱/URL 的 `@`：`/(?<![a-zA-Z0-9_])@([\w\u4e00-\u9fa5-]+)/g` |
| 角色发言回读 | `session/event` 的 `turn/end` + `assistantTextSince(session, sinceSeq)`（sinceSeq=followup 前 events.length） |
| 讨论结果展示 | 无"追加 assistant 消息到别的会话"的官方 API（事件流 append-only）；用主会话 `agent.followup(汇总文本)` 触发主持人收敛 |

## 保留 / 移除

- 保留：角色库（形象/SOUL/性格）、New Agent 模态、编辑/删除角色、SSE 同步、state.json 持久化。
- 移除：房间、右栏活动、中心区覆盖面板、一键总结面板、发言模式（all/chain）。
- 砍掉：Capabilities 技能栏（DSH 宿主自带工具能力，插件自定义技能清单是画蛇添足）。
