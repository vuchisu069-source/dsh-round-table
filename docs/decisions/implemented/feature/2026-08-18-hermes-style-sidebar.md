# D6 — Hermes 范式侧栏集成

- 日期：2026-08-18
- 状态：✅ 已实施
- 范围：客户端 UI 重构（节点侧零行为变化）

## 背景

round-table 之前以一个**浮动 modal**（900×560，居中浮层）作为唯一入口，3 栏内嵌于 modal 内。
modal 模式的问题：

1. 隐藏感强——用户离开 modal 即"退出"圆桌，角色/房间不在视野中
2. 创建角色走 3 次串行 `window.prompt`，无法选形象
3. 与 DSH 宿主 UI 割裂，存在感弱

参考 Hermes：bots 作为一等公民常驻左侧栏，创建走完整模态带形象选择器（形状+颜色+emoji）。

## 决策

### D6.1 — 角色形象数据模型

每个 role 新增 `avatar: { shape, emoji, color }` 字段：

| 字段 | 取值 | 默认 |
|---|---|---|
| `shape` | `circle` \| `square` \| `hexagon` \| `triangle` | `circle` |
| `emoji` | 字符串（≤8 字符） | `🙂` |
| `color` | `#rrggbb` | PALETTE[0] (`#8b9dc3`) |

**渲染**：内联 SVG——`<path>` 填充色 + `<text>` 居中 emoji（不同形状的 emoji 位置/字号微调，避免溢出）。

**向后兼容**：`lib/src/state.mjs` 新增 `normalizeAvatar()` + `migrateState()`。加载旧 `state.json` 时，无 avatar 字段的角色自动补默认值（沿用旧 `color`）。**不破坏现有数据**。

### D6.2 — 客户端布局：左栏 + 右栏 + 中心区

| 区域 | 实现 | 内容 |
|---|---|---|
| **左栏** | 注入到宿主左栏底部（`findLeftSidebarContainer` 启发式 + MutationObserver 防重渲染冲掉） | 「圆桌成员」section：角色卡片（avatar+名称+人设摘要+编辑按钮），底部「+ 新建角色」「+ 新建房间」 |
| **右栏** | 浮动右栏（DSH 无原生右栏时的兜底）始终可见 | 房间列表 + 当前房间头部 + 成员状态 + 控制按钮（暂停/继续/总结）+ 最大轮数 + 总结卡 |
| **中心区** | 浮动覆盖层（`left:240px right:300px`），选中房间时显示，空态/未选时隐藏 | 当前房间时间线 + 输入区（@指定/全体研讨/接力链模式切换） |

**布局常量**（`LEFT_SIDEBAR_OFFSET=240`、`RIGHT_PANEL_WIDTH=300`）—— DSH 左栏宽度变化时可调。

### D6.3 — New Agent 模态（替换 3 次 window.prompt）

完整模态，含：
- 大形象预览（96px 实时同步）
- 形状选择（4 个）
- 表情选择（10 个）
- 颜色调色板（8 色）
- 字段：名称（必填）、Title、描述、System Prompt、性格参数

支持**编辑**（点击角色卡 ⋯ 按钮）：保留原 id 触发服务端 `upsertRole` 的更新语义。

### D6.4 — 一键总结仍为骨架

`/control` 的 `summarize` 行为不变（v1 仍是文本骨架，真实总结者 Agent 待接线）。

## 副作用

| 项 | 影响 |
|---|---|
| 持久化 | `state.json` 旧数据：自动迁移，新字段补默认（migrateState） |
| Node API | `/roles` 端点：`createRole` 现在接受 `avatar/title/description`，旧调用仍兼容 |
| 构建产物 | `lib/client.js` 需重新生成（`npm run build:client`） |
| 测试 | 新增 8 个测试覆盖 `normalizeAvatar`/`migrateState`/`createRole` 默认值（19/19 通过） |
| UI 脆弱点 | 沿用旧版的"按可见文本找标签 + MutationObserver"启发式；DSH 改版可能需要重新定位 |

## 验证

- ✅ 纯逻辑单测：19/19 通过
- ✅ `npm run build:client` 生成产物
- ✅ `npm run check:client` 校验产物与源一致
- ⏳ 端到端：需在 DSH web GUI 内实测（受沙箱限制，未跑）

## 后续候选

- 中心区讨论面板在选中房间时直接覆盖宿主主区；可考虑改为"侧滑抽屉"以保留主会话可见
- 左栏 section 当前注入到左栏底部；若 DSH 已有更合适位置（如"工作区"下），可加偏好
- 一键总结接入真 Agent（沿用 D3 决策）
