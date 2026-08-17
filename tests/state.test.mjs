// round-table 纯逻辑单测（node:test）：状态账本 + 队列/轮次推进 + 会话标题推导 + avatar 归一化（D6）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRole, createRoom, addMember, appendMessage, setPaused, setMaxRounds,
  buildQueue, advance, normalizeAvatar, defaultAvatar, migrateState,
  SOUL_MAX_CHARS,
  DEFAULT_SHAPES, DEFAULT_EMOJIS, DEFAULT_PALETTE,
} from '../lib/src/state.mjs'
import { firstUserMessageText, sessionDisplayTitle } from '../lib/src/titles.mjs'

const roomWithMembers = (mode = 'all', maxRounds = 2) => {
  let room = createRoom({ id: 'r1', title: 't', mode, maxRounds })
  for (const id of ['a', 'b']) room = addMember(room, { id, roleId: `role-${id}` })
  return room
}

test('buildQueue: manual 模式只含 @ 提及且在房间内的成员', () => {
  const room = roomWithMembers('manual')
  assert.deepEqual(buildQueue(room, ['b', 'a']), ['b', 'a'])
  assert.deepEqual(buildQueue(room, ['b', 'nobody']), ['b'])
  assert.deepEqual(buildQueue(room, []), [])
})

test('buildQueue: all/chain 模式为全体成员按序', () => {
  const room = roomWithMembers('all')
  assert.deepEqual(buildQueue(room), ['a', 'b'])
})

test('advance: 全体模式一轮完成后开新一轮，达上限停止', () => {
  let room = roomWithMembers('all', 2)
  room = { ...room, queue: buildQueue(room), running: true }
  // a 发言完 → 下一位 b
  let next = advance(room)
  assert.equal(next.nextSpeaker, 'b')
  // b 发言完 → 第 1 轮完成，开第 2 轮，回链首 a
  next = advance(next.room)
  assert.equal(next.nextSpeaker, 'a')
  assert.equal(next.room.round, 1)
  // 第 2 轮 a、b 依次发言完 → 达上限停止
  next = advance(next.room)
  assert.equal(next.nextSpeaker, 'b')
  next = advance(next.room)
  assert.equal(next.nextSpeaker, null)
  assert.equal(next.room.running, false)
  assert.equal(next.room.round, 2)
})

test('advance: manual 模式队列耗尽即停', () => {
  let room = roomWithMembers('manual')
  room = { ...room, queue: ['a'], running: true }
  const next = advance(room)
  assert.equal(next.nextSpeaker, null)
  assert.equal(next.room.running, false)
})

test('setPaused / setMaxRounds 边界', () => {
  let room = createRoom({ id: 'r', title: 't' })
  room = setPaused(room, true)
  assert.equal(room.paused, true)
  room = setMaxRounds(room, 99)
  assert.equal(room.maxRounds, 20)
  room = setMaxRounds(room, 0)
  assert.equal(room.maxRounds, 1)
})

test('addMember: 会话成员（kind session）与角色成员并存', () => {
  let room = createRoom({ id: 'r', title: 't' })
  room = addMember(room, { id: 'm1', roleId: 'role-a' })
  room = addMember(room, { id: 'm2', kind: 'session', sessionId: 'sess-1', title: '主对话' })
  assert.equal(room.members.length, 2)
  assert.equal(room.members[0].kind, 'role')
  assert.equal(room.members[1].kind, 'session')
  assert.equal(room.members[1].sessionId, 'sess-1')
  assert.equal(room.members[1].title, '主对话')
  // 重复加入同一会话成员不生效
  room = addMember(room, { id: 'm2', kind: 'session', sessionId: 'sess-1' })
  assert.equal(room.members.length, 2)
})

test('buildQueue: all 模式包含会话成员', () => {
  let room = createRoom({ id: 'r', title: 't', mode: 'all' })
  room = addMember(room, { id: 'm1', roleId: 'role-a' })
  room = addMember(room, { id: 'm2', kind: 'session', sessionId: 'sess-1' })
  assert.deepEqual(buildQueue(room), ['m1', 'm2'])
})

test('appendMessage 追加并自动补 id/ts', () => {
  let room = createRoom({ id: 'r', title: 't' })
  room = appendMessage(room, { kind: 'user', text: 'hello' })
  assert.equal(room.messages.length, 1)
  assert.ok(room.messages[0].id)
  assert.ok(room.messages[0].ts > 0)
})

test('firstUserMessageText: 取首条用户消息文本，截断 40 字', () => {
  const session = {
    id: 's1',
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { role: 'user', id: 'm1', content: [{ type: 'text', text: '  帮我设计一个支付网关  ' }] } },
      { type: 'user/message', data: { role: 'user', id: 'm2', content: [{ type: 'text', text: '第二条' }] } },
    ],
  }
  assert.equal(firstUserMessageText(session), '帮我设计一个支付网关')
  const long = { id: 's2', events: [{ type: 'user/message', data: { role: 'user', id: 'm', content: [{ type: 'text', text: 'x'.repeat(80) }] } }] }
  assert.equal(firstUserMessageText(long), `${'x'.repeat(40)}…`)
  assert.equal(firstUserMessageText({ id: 's3', events: [] }), null)
  assert.equal(firstUserMessageText({ id: 's4' }), null)
})

test('sessionDisplayTitle: header.title 优先，其次首条消息，再次时间，最后 id', () => {
  const titled = { id: 's1', header: { title: '支付网关评审' }, events: [{ type: 'user/message', data: { role: 'user', id: 'm', content: [{ type: 'text', text: '议题' }] } }] }
  assert.equal(sessionDisplayTitle(titled), '支付网关评审')
  const untitled = { id: 's2', header: { createdAt: 1786860000000 }, events: [{ type: 'user/message', data: { role: 'user', id: 'm', content: [{ type: 'text', text: '帮我写个文案' }] } }] }
  assert.equal(sessionDisplayTitle(untitled), '帮我写个文案')
  const noEvents = { id: 's3', header: { createdAt: 1786860000000 } }
  assert.ok(sessionDisplayTitle(noEvents).startsWith('对话 '))
  const bare = { id: 's4' }
  assert.equal(sessionDisplayTitle(bare), 's4')
})

// ---- D6：avatar 归一化与 migrate ----

test('defaultAvatar: 返回合法 shape/emoji/color', () => {
  const a = defaultAvatar()
  assert.ok(DEFAULT_SHAPES.includes(a.shape))
  assert.ok(a.emoji.length > 0)
  assert.match(a.color, /^#[0-9a-fA-F]{6}$/)
})

test('createRole: 默认带 avatar 字段（circle/🙂/PALETTE[0]）', () => {
  const r = createRole({ id: 'r1', name: 'A' })
  assert.ok(r.avatar)
  assert.equal(r.avatar.shape, 'circle')
  assert.equal(r.avatar.emoji, '🙂')
  assert.equal(r.avatar.color, DEFAULT_PALETTE[0])
  // 旧字段保留
  assert.equal(r.name, 'A')
  assert.equal(r.color, '#8b9dc3')
})

test('createRole: 显式传 avatar 透传', () => {
  const r = createRole({
    id: 'r1', name: 'A',
    avatar: { shape: 'hexagon', emoji: '😎', color: '#e8a838' },
  })
  assert.equal(r.avatar.shape, 'hexagon')
  assert.equal(r.avatar.emoji, '😎')
  assert.equal(r.avatar.color, '#e8a838')
})

test('normalizeAvatar: 非法 shape/emoji/color 兜底到默认', () => {
  const a = normalizeAvatar({ shape: 'invalid-shape', emoji: '', color: 'not-hex' })
  assert.equal(a.shape, 'circle')
  assert.equal(a.emoji, '🙂')
  assert.equal(a.color, DEFAULT_PALETTE[0])
})

test('normalizeAvatar: null/非对象输入返回 fallback', () => {
  assert.deepEqual(normalizeAvatar(null), defaultAvatar())
  assert.deepEqual(normalizeAvatar(undefined), defaultAvatar())
  assert.deepEqual(normalizeAvatar('bad'), defaultAvatar())
  assert.deepEqual(normalizeAvatar(42), defaultAvatar())
})

test('normalizeAvatar: 部分字段合法时仅修正非法字段', () => {
  const a = normalizeAvatar({ shape: 'square', emoji: '🤖', color: 'bad' })
  assert.equal(a.shape, 'square')   // 合法
  assert.equal(a.emoji, '🤖')       // 合法
  assert.equal(a.color, DEFAULT_PALETTE[0])  // 非法 → 兜底
})

test('normalizeAvatar: emoji 长度边界（> 8 字符拒绝）', () => {
  const a = normalizeAvatar({ shape: 'circle', emoji: 'x'.repeat(9), color: '#fff' })
  assert.equal(a.emoji, '🙂')  // 拒绝过长 emoji → 默认
})

test('migrateState: 旧 role（无 avatar）补默认；新 role（已有 avatar）不动', () => {
  const old = {
    roles: [
      { id: 'r1', name: '老角色', color: '#abcdef' },
      { id: 'r2', name: '新角色', color: '#123456', avatar: { shape: 'square', emoji: '🦊', color: '#e8a838' } },
    ],
    rooms: [],
  }
  const next = migrateState(old)
  assert.equal(next.roles.length, 2)
  // 老角色补 avatar，沿用原 color
  assert.equal(next.roles[0].avatar.shape, 'circle')
  assert.equal(next.roles[0].avatar.emoji, '🙂')
  assert.equal(next.roles[0].avatar.color, '#abcdef')
  // 新角色 avatar 不动
  assert.equal(next.roles[1].avatar.shape, 'square')
  assert.equal(next.roles[1].avatar.emoji, '🦊')
  assert.equal(next.roles[1].avatar.color, '#e8a838')
  // rooms 透传
  assert.deepEqual(next.rooms, [])
})

test('migrateState: null/非对象/缺字段安全处理', () => {
  assert.deepEqual(migrateState(null), { roles: [], rooms: [] })
  assert.deepEqual(migrateState(undefined), { roles: [], rooms: [] })
  assert.deepEqual(migrateState({}), { roles: [], rooms: [] })
  // roles 不是数组时 → 空
  const next = migrateState({ roles: 'bad', rooms: 'also bad' })
  assert.deepEqual(next.roles, [])
  assert.deepEqual(next.rooms, [])
  // 数组中夹杂非对象项 → 透传（不崩）
  const next2 = migrateState({ roles: [null, 'bad', 42, { id: 'ok', name: 'O' }], rooms: [] })
  assert.equal(next2.roles.length, 4)
  assert.equal(next2.roles[3].name, 'O')
  assert.ok(next2.roles[3].avatar)  // 有效对象也被补 avatar
})

// ---- Advanced（Hermes 范式）：soul ----

test('createRole: 默认 soul 空', () => {
  const r = createRole({ id: 'r1', name: 'A' })
  assert.equal(r.soul, '')
})

test('createRole: 显式传 soul 透传', () => {
  const r = createRole({ id: 'r1', name: 'A', soul: '# 角色灵魂\n资深专家' })
  assert.equal(r.soul, '# 角色灵魂\n资深专家')
})

test('migrateState: 旧 role 补 soul 默认', () => {
  const next = migrateState({ roles: [{ id: 'r1', name: '老', color: '#abc' }], rooms: [] })
  assert.equal(next.roles[0].soul, '')
  // 已有值的保留
  const next2 = migrateState({ roles: [{ id: 'r2', name: '新', soul: 'x' }], rooms: [] })
  assert.equal(next2.roles[0].soul, 'x')
})

test('SOUL_MAX_CHARS 定义存在（防长文档烧 token）', () => {
  assert.equal(typeof SOUL_MAX_CHARS, 'number')
  assert.ok(SOUL_MAX_CHARS > 0)
})
