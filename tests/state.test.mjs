// round-table 纯逻辑单测（node:test）：状态账本 + 队列/轮次推进 + 会话标题推导。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRole, createRoom, addMember, appendMessage, setPaused, setMaxRounds,
  buildQueue, advance,
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
