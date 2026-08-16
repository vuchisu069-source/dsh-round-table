# 2026-08-16 — 时间线滚动位置保护（贴底跟随 vs 阅读锚点）

**分类**：bug-fix
**状态**：implemented

## 现象

圆桌面板打开后，时间线滚动到顶部阅读历史，约 3 秒内自动跳回底部。

## 根因

`renderTimeline()` 每次渲染末尾都执行 `scrollTop = scrollHeight`（强制贴底）。
client 每 3 秒轮询一次 `/state`（SSE 断线兜底），每次状态往返都触发整树重渲染
→ 用户一旦向上翻历史，下一轮轮询就把他拽回底部，无法阅读早期消息。

## 修复

滚动策略改为「贴底跟随 / 阅读锚点」二态：
- 渲染前若距底 <48px（贴底态）→ 渲染后继续 `scrollTop = scrollHeight`（新消息自然跟随）
- 否则（用户上翻）→ 记录视口顶部第一个可见消息的 `data-msg-id` 为锚点，
  渲染后 `scrollIntoView({ block: 'start' })` 复位到该消息

## 验证

无头 Chrome：时间线滚到顶部（scrollTop=43）→ 等待 8s（跨 2+ 轮询周期）→
scrollTop 保持 43，未跳回底部。贴底态仍正常跟随新消息。
