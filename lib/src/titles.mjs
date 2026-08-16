// 会话标题推导（纯函数，零宿主依赖，可单测）。
// 用途：工作区会话列表的标题兜底——未命名会话避免显示原始 UUID（乱码观感）。
// 优先级：header.title（宿主） → 首条用户消息文本 → 创建时间 → id。

/** 取会话首条用户消息的文本（截断 40 字）；无则 null。 */
export function firstUserMessageText(session) {
  if (!Array.isArray(session?.events)) return null
  for (const e of session.events) {
    if (e === null || typeof e !== 'object' || e.type !== 'user/message') continue
    const data = e.data
    const msg = data !== null && typeof data === 'object' && data.message ? data.message : data
    const content = Array.isArray(msg?.content) ? msg.content : []
    const block = content.find((b) => b !== null && typeof b === 'object' && b.type === 'text')
    const text = typeof block?.text === 'string' ? block.text.trim() : ''
    if (text.length > 0) return text.length > 40 ? `${text.slice(0, 40)}…` : text
  }
  return null
}

/** 组装会话展示标题：header.title → 首条用户消息 → 时间 → id。 */
export function sessionDisplayTitle(session) {
  const headerTitle = typeof session?.header?.title === 'string' && session.header.title ? session.header.title : null
  if (headerTitle !== null) return headerTitle
  const firstText = firstUserMessageText(session)
  if (firstText !== null) return firstText
  if (typeof session?.header?.createdAt === 'number') {
    return `对话 ${new Date(session.header.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
  }
  return typeof session?.id === 'string' ? session.id : '未知会话'
}
