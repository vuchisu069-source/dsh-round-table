// round-table mentions/讨论 prompt 纯逻辑单测（node:test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseMentions, matchRoles, composeSingleRoleSection, composeMultiWaitSection,
  composeRolePrompt, composeSummaryPrompt, roleCard,
  TEXT_ONLY_INSTRUCTION, TOOLS_AVAILABLE_INSTRUCTION,
} from '../lib/src/mentions.mjs'

const roles = [
  { id: 'r1', name: '架构师', systemPrompt: '架构师设定', personality: '严谨', soul: '', skills: ['read'] },
  { id: 'r2', name: '产品经理', systemPrompt: 'PM 设定', personality: '', soul: '', skills: [] },
  { id: 'r3', name: '安全专家', systemPrompt: '', personality: '谨慎', soul: '', skills: [] },
]

test('parseMentions: 解析 @角色名（中文/英文/数字/连字符）', () => {
  assert.deepEqual(parseMentions('@架构师 帮我设计'), ['架构师'])
  assert.deepEqual(parseMentions('@架构师 @产品经理 讨论'), ['架构师', '产品经理'])
  assert.deepEqual(parseMentions('邮箱 abc@example.com 不是角色'), [])
  assert.deepEqual(parseMentions('@Role-X 测试'), ['Role-X'])
  assert.deepEqual(parseMentions('没有提及'), [])
  assert.deepEqual(parseMentions(null), [])
  assert.deepEqual(parseMentions(undefined), [])
})

test('matchRoles: 按 @ 顺序匹配、去重、上限 4', () => {
  const matched = matchRoles(roles, ['产品经理', '架构师', '产品经理'])
  assert.deepEqual(matched.map((r) => r.name), ['产品经理', '架构师'])
  // 未匹配的角色跳过
  assert.deepEqual(matchRoles(roles, ['不存在', '架构师']).map((r) => r.name), ['架构师'])
  // 上限 4
  const many = matchRoles(roles, ['架构师', '产品经理', '安全专家', '架构师', '产品经理'])
  assert.ok(many.length <= 4)
  // 空输入
  assert.deepEqual(matchRoles(roles, []), [])
  assert.deepEqual(matchRoles(null, ['架构师']), [])
})

test('composeSingleRoleSection: 含角色卡 + 工具可用提示（放开宿主工具）', () => {
  const s = composeSingleRoleSection(roles[0])
  assert.ok(s.includes('角色扮演指令'))
  assert.ok(s.includes('架构师'))
  assert.ok(s.includes('架构师设定'))
  assert.ok(s.includes(TOOLS_AVAILABLE_INSTRUCTION))
  assert.ok(!s.includes(TEXT_ONLY_INSTRUCTION))
  assert.ok(s.includes('不要以通用助手身份回应'))
})

test('composeMultiWaitSection: 多角色协调等待（不展开讨论）', () => {
  const s = composeMultiWaitSection([roles[0], roles[1]])
  assert.ok(s.includes('独立发言'))
  assert.ok(s.includes('架构师') && s.includes('产品经理'))
  assert.ok(s.includes('不是') && s.includes('不要') && s.includes('扮演'))
  assert.ok(s.includes('必须') && s.includes('只回复这一句话'))
  assert.ok(s.includes('禁止') && s.includes('调用任何工具'))
})

test('composeRolePrompt: 第 0 位无前序发言；后续含前序发言并要求回应', () => {
  const run = { question: '讨论导出功能', matched: roles.slice(0, 2), replies: [] }
  const p0 = composeRolePrompt(run, roles[0], 0)
  assert.ok(p0.includes('议题：讨论导出功能'))
  assert.ok(p0.includes('架构师设定'))
  assert.ok(!p0.includes('前序发言'))
  assert.ok(p0.includes('给出你对该议题的观点'))
  assert.ok(p0.includes(TOOLS_AVAILABLE_INSTRUCTION))

  // 模拟架构师回复后，产品经理收到前序
  run.replies.push('架构师：建议前端生成')
  const p1 = composeRolePrompt(run, roles[1], 1)
  assert.ok(p1.includes('前序发言'))
  assert.ok(p1.includes('架构师：建议前端生成'))
  assert.ok(p1.includes('针对上面其他角色的发言给出你的回应'))
  assert.ok(p1.includes('补充、质疑或修正'))
  assert.ok(p1.includes('回复后结束'))
})

test('composeSummaryPrompt: 主持人收敛指令', () => {
  const s = composeSummaryPrompt(['架构师：前端生成', '产品经理：同意并排期'])
  assert.ok(s.includes('圆桌讨论结果'))
  assert.ok(s.includes('共识点'))
  assert.ok(s.includes('分歧点'))
  assert.ok(s.includes('行动建议'))
  assert.ok(s.includes('架构师：前端生成'))
  assert.ok(s.includes(TEXT_ONLY_INSTRUCTION))
})

test('roleCard: 空字段不产生空行', () => {
  const c = roleCard({ systemPrompt: '', personality: '', soul: '', skills: [] }, '')
  assert.equal(c, '')
  const c2 = roleCard({ systemPrompt: 'x', personality: '', soul: '', skills: [] }, '')
  assert.ok(c2.includes('System Prompt：x'))
})
