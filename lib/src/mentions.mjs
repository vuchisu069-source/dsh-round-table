// round-table 提及解析与讨论 prompt 组装（纯函数，零宿主依赖，可单测）。
// v2 范式：单角色 = 主会话扮演（角色卡 + 纯文本强制）；多角色 = 独立会话接力（真讨论）。
import { SOUL_MAX_CHARS } from './state.mjs'

/** 解析文本中的 @角色名（与 client @ source 插入的字面文本一致；排除邮箱/URL 里的 @）。 */
export function parseMentions(text) {
  if (typeof text !== 'string') return []
  return [...text.matchAll(/(?<![a-zA-Z0-9_])@([\w\u4e00-\u9fa5-]+)/g)].map((m) => m[1])
}

/** 按 @ 顺序匹配角色（去重、上限 4 个，防 prompt 爆炸）。 */
export function matchRoles(roles, mentions) {
  const matched = []
  const seen = new Set()
  for (const name of mentions) {
    if (seen.has(name)) continue
    const role = (roles ?? []).find((r) => r !== null && typeof r === 'object' && r.name === name)
    if (role !== undefined) {
      matched.push(role)
      seen.add(name)
    }
    if (matched.length >= 4) break
  }
  return matched
}

// ---- 角色卡/指令组装 ----

/** SOUL 文本（截断防烧 token）。 */
export function soulText(r) {
  if (typeof r.soul !== 'string' || r.soul.length === 0) return null
  const clipped = r.soul.length > SOUL_MAX_CHARS ? `${r.soul.slice(0, SOUL_MAX_CHARS)}\n（角色档案过长，已截断）` : r.soul
  return `   角色档案（SOUL）：\n${clipped}`
}

/** 角色卡核心（System Prompt / 性格 / SOUL）。注：技能声明已砍——DSH 宿主自带工具能力。 */
export function roleCard(r, prefix = '') {
  return [
    r.systemPrompt ? `${prefix}System Prompt：${r.systemPrompt}` : null,
    r.personality ? `${prefix}性格：${r.personality}` : null,
    soulText(r),
  ].filter((l) => l !== null).join('\n')
}

/** 纯文本强制指令（仅用于：多角色协调等待 + 主持人汇总——这两个阶段不允许调工具）。 */
export const TEXT_ONLY_INSTRUCTION = '（重要：只允许纯文本回答，禁止调用任何工具、禁止读取文件、禁止执行命令。）'

/** 工具可用提示（单角色扮演 + 角色独立会话——放开宿主工具，角色可读代码/干活）。 */
export const TOOLS_AVAILABLE_INSTRUCTION = '（如需要，你可以使用可用工具（读文件、搜索、执行命令等）辅助回答。）'

/** 单角色：主会话扮演指令（v2：放开宿主工具，角色可用工具干活）。 */
export function composeSingleRoleSection(role) {
  const card = roleCard(role, '')
  return [
    '# 角色扮演指令（round-table）',
    `用户在本条消息中通过 @ 点名了角色「${role.name}」。`,
    card || `你是「${role.name}」。`,
    `请完全以「${role.name}」的身份、用第一人称回答本条消息，不要以通用助手身份回应。${TOOLS_AVAILABLE_INSTRUCTION}`,
  ].join('\n')
}

/** 多角色：主会话协调等待指令（角色独立讨论由 round-table 编排，结果稍后注入）。 */
export function composeMultiWaitSection(matched) {
  const names = matched.map((r) => `「${r.name}」`).join('、')
  return [
    '# 角色协调指令（round-table）',
    `本条消息 @ 了多个角色（${names}），这些角色将由 round-table 分别驱动**独立发言**。`,
    '你**不是**其中任何角色，**不要**扮演它们、**不要**替它们回答。',
    '你**必须**只回复这一句话：「已收到，各角色独立讨论进行中，结果稍后汇总。」',
    '**禁止**回答任何其他内容、**禁止**调用任何工具、**禁止**读取文件、**禁止**执行命令。',
  ].join('\n')
}

/**
 * 角色独立会话的发言 prompt（v2 真讨论）：
 * - 第 0 位：议题 + 自己的角色卡
 * - 后续：议题 + 自己的角色卡 + 前序角色的真实发言（要求针对回应）
 * 角色放开宿主工具（可读代码/干活），仅约束"回复后结束"。
 */
export function composeRolePrompt({ question, matched, replies }, role, idx) {
  const prev = replies.length > 0 ? replies.join('\n') : null
  const lines = [
    '# 圆桌讨论邀请（round-table）',
    `主会话用户发起了多角色讨论，你被邀请以「${role.name}」的身份参与。`,
    `议题：${question}`,
    roleCard(role, ''),
    prev !== null ? `# 前序发言（其他角色已独立发言）\n${prev}` : null,
    idx === 0
      ? `请以「${role.name}」的身份给出你对该议题的观点。${TOOLS_AVAILABLE_INSTRUCTION}`
      : `请以「${role.name}」的身份，针对上面其他角色的发言给出你的回应（可补充、质疑或修正其观点）。${TOOLS_AVAILABLE_INSTRUCTION}`,
    '回复后结束（不要继续讨论）。',
  ]
  return lines.filter((l) => l !== null).join('\n')
}

/** 主会话汇总 prompt：注入各角色独立发言，要求以主持人身份收敛。 */
export function composeSummaryPrompt(replies) {
  return [
    '# 圆桌讨论结果（round-table）',
    '以下是各角色独立推理的真实发言：',
    replies.join('\n\n'),
    '请以主持人身份输出这份讨论记录：**共识点** / **分歧点** / **行动建议**。',
    '要求：纯文本、简洁、分点列出；不要重复角色发言全文，只做收敛提炼。' + TEXT_ONLY_INSTRUCTION,
  ].join('\n')
}
