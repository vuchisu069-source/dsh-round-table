// round-table 纯状态账本（零宿主依赖，可单测）。
// 概念（决策 D5）：角色（role）由用户自建，存于角色库（roles），跨房间复用；
// 房间（room）的成员（member）是「角色 + 房间内状态」的实例（引 roleId）。
// 消息（message）是时间线的不可变事件流；讨论控制态（paused/round/mode/queue）随房间。
// 角色形象（avatar，决策 D6）：Hermes 范式——shape(4) + emoji(10) + color(8) 组合，
// 旧 state.json 无 avatar 字段时 createRole 兜底默认值，向后兼容。
// 所有操作返回新对象（不可变更新），由调用方负责持久化。

// ---- 工厂 ----

export const DEFAULT_SHAPES = ['circle', 'square', 'hexagon', 'triangle']
export const DEFAULT_EMOJIS = ['🙂', '😎', '🤓', '😴', '😡', '😺', '👻', '🦊', '🐱', '🤖']
export const DEFAULT_PALETTE = ['#8b9dc3', '#e8a838', '#5fbf7a', '#d97c7c', '#7c8fe8', '#c77ce8', '#e87cb0', '#6fc7c7']

/** 兜底 avatar（无输入时使用）。 */
export function defaultAvatar() {
  return { shape: 'circle', emoji: '🙂', color: DEFAULT_PALETTE[0] }
}

/** 归一化 avatar 输入：缺字段补默认，非法值兜底。 */
export function normalizeAvatar(input, fallback) {
  const f = fallback ?? defaultAvatar()
  if (input === null || typeof input !== 'object') return f
  const shape = DEFAULT_SHAPES.includes(input.shape) ? input.shape : f.shape
  const emoji = typeof input.emoji === 'string' && input.emoji.length > 0 && input.emoji.length <= 8
    ? input.emoji
    : f.emoji
  const color = typeof input.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.color)
    ? input.color
    : f.color
  return { shape, emoji, color }
}

/**
 * 迁移旧 state.json：旧版 role 没有 avatar/title/description/soul 字段，运行时补默认值。
 * 纯函数：输入 state → 归一化 state；调用方负责落盘。
 * 注：skills/bundledSkills 已砍（宿主自带工具能力），旧数据里的残留字段不删、不再补默认。
 */
export function migrateState(state) {
  if (state === null || typeof state !== 'object') return { roles: [], rooms: [] }
  return {
    roles: Array.isArray(state.roles)
      ? state.roles.map((r) => {
        if (r === null || typeof r !== 'object') return r
        const next = { ...r }
        if (!(next.avatar !== undefined && typeof next.avatar === 'object')) {
          next.avatar = normalizeAvatar(null, { shape: 'circle', emoji: '🙂', color: typeof next.color === 'string' ? next.color : '#8b9dc3' })
        }
        if (typeof next.soul !== 'string') next.soul = ''
        return next
      })
      : [],
    rooms: Array.isArray(state.rooms) ? state.rooms : [],
  }
}

/** SOUL 注入时的硬上限（字符），防长文档每轮烧 token。 */
export const SOUL_MAX_CHARS = 2000

export function createRole({ id, name, color, systemPrompt, personality, avatar, title, description, soul }) {
  return {
    id,
    name: String(name ?? '未命名角色'),
    color: String(color ?? '#8b9dc3'),
    // 向后兼容：旧客户端未传 color 时，从 DEFAULT_PALETTE 选一个
    avatar: normalizeAvatar(avatar, { shape: 'circle', emoji: '🙂', color: String(color ?? '#8b9dc3') }),
    title: typeof title === 'string' ? title : '',
    description: typeof description === 'string' ? description : '',
    systemPrompt: String(systemPrompt ?? ''),
    personality: String(personality ?? ''),
    // Advanced（Hermes 范式）：SOUL.md 人设文档。技能/API key 已砍——
    // DSH 宿主自带工具能力（读代码/跑命令等），无需插件定义技能清单。
    soul: typeof soul === 'string' ? soul : '',
    createdAt: Date.now(),
  }
}

export function createRoom({ id, title, mode = 'manual', maxRounds = 5 }) {
  return {
    id,
    title: String(title ?? '未命名房间'),
    members: [],          // [{ id, roleId, status: 'idle'|'thinking'|'error', joinedAt }]
    messages: [],         // [{ id, kind, authorId?, authorName?, color?, text, ts, round, refId? }]
    summaries: [],        // [{ id, text, ts, by }]
    mode,                 // manual | all | chain
    maxRounds,            // 防死循环硬上限
    paused: false,
    running: false,       // 讨论是否进行中（有未完成的发言队列）
    round: 0,             // 已完成轮次
    queue: [],            // 待发言成员 id 队列（按序弹出）
    updatedAt: Date.now(),
    createdAt: Date.now(),
  }
}

// ---- 角色库 ----

export function upsertRole(roles, role) {
  const next = roles.filter((r) => r.id !== role.id)
  next.push(role)
  return next
}

export function removeRole(roles, roleId) {
  return roles.filter((r) => r.id !== roleId)
}

// ---- 房间成员 ----
// kind: 'role'（自建角色，驱动插件自建的 agent 会话）| 'session'（工作区既有对话框，驱动真实会话）
// role 成员：roleId 指向角色库；session 成员：sessionId 指向宿主会话 + title 快照。
export function addMember(room, { id, kind = 'role', roleId, sessionId, title }) {
  if (room.members.some((m) => m.id === id)) return room
  const base = { id, kind, status: 'idle', joinedAt: Date.now() }
  if (kind === 'session') base.sessionId = sessionId
  else base.roleId = roleId
  if (title !== undefined) base.title = title
  return {
    ...room,
    members: [...room.members, base],
    updatedAt: Date.now(),
  }
}

export function removeMember(room, memberId) {
  return {
    ...room,
    members: room.members.filter((m) => m.id !== memberId),
    queue: room.queue.filter((id) => id !== memberId),
    updatedAt: Date.now(),
  }
}

export function setMemberStatus(room, memberId, status) {
  return {
    ...room,
    members: room.members.map((m) => (m.id === memberId ? { ...m, status } : m)),
    updatedAt: Date.now(),
  }
}

// ---- 消息 ----

let msgSeq = 0
export function nextMessageId() {
  msgSeq += 1
  return `msg-${Date.now().toString(36)}-${msgSeq.toString(36)}`
}

export function appendMessage(room, msg) {
  return {
    ...room,
    messages: [...room.messages, { ...msg, id: msg.id ?? nextMessageId(), ts: msg.ts ?? Date.now() }],
    updatedAt: Date.now(),
  }
}

// ---- 讨论控制 ----

export function setMode(room, mode) {
  if (!['manual', 'all', 'chain'].includes(mode)) return room
  return { ...room, mode, updatedAt: Date.now() }
}

export function setPaused(room, paused) {
  return { ...room, paused, updatedAt: Date.now() }
}

export function setMaxRounds(room, maxRounds) {
  const parsed = Number(maxRounds)
  const n = Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 5
  return { ...room, maxRounds: n, updatedAt: Date.now() }
}

/**
 * 计算某次发言的待发言队列（纯函数）：
 * - manual：@ 提及的成员（按提及顺序，过滤不在房间的）
 * - all / chain：房间成员按加入顺序（链式即此顺序；回链首由轮次上限控制）
 * @param {object} room 房间
 * @param {string[]} mentions 手动模式下的成员 id 列表
 * @returns {string[]} 成员 id 队列
 */
export function buildQueue(room, mentions = []) {
  if (room.mode === 'manual') {
    return mentions.filter((id) => room.members.some((m) => m.id === id))
  }
  return room.members.map((m) => m.id)
}

/**
 * 推进讨论状态：当前发言者出队；队列空时若未达轮次上限且非手动模式则开新一轮（回链首）。
 * @param {object} room 房间
 * @returns {{ room: object, nextSpeaker: string|null }} nextSpeaker 为下一步应发言的成员 id
 */
export function advance(room) {
  const queue = [...room.queue]
  const speaker = queue.shift() ?? null
  let next = { ...room, queue, updatedAt: Date.now() }
  let nextSpeaker = queue[0] ?? null
  if (speaker !== null) {
    // 单次发言完成：手动模式队列耗尽即停；all/chain 队列耗尽进入下一轮（回链首）
    if (queue.length === 0 && room.mode !== 'manual') {
      const newRound = room.round + 1
      if (newRound >= room.maxRounds) {
        next = { ...next, round: newRound, running: false }
        nextSpeaker = null
      } else {
        const fresh = room.members.map((m) => m.id)
        next = { ...next, round: newRound, queue: fresh }
        nextSpeaker = fresh[0] ?? null
      }
    } else if (queue.length === 0) {
      next = { ...next, running: false }
      nextSpeaker = null
    }
  }
  return { room: next, nextSpeaker }
}
