// round-table 纯状态账本（零宿主依赖，可单测）。
// 概念（决策 D5）：角色（role）由用户自建，存于角色库（roles），跨房间复用；
// 房间（room）的成员（member）是「角色 + 房间内状态」的实例（引 roleId）。
// 消息（message）是时间线的不可变事件流；讨论控制态（paused/round/mode/queue）随房间。
// 所有操作返回新对象（不可变更新），由调用方负责持久化。

// ---- 工厂 ----

export function createRole({ id, name, color, systemPrompt, personality }) {
  return {
    id,
    name: String(name ?? '未命名角色'),
    color: String(color ?? '#8b9dc3'),
    systemPrompt: String(systemPrompt ?? ''),
    personality: String(personality ?? ''),
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
