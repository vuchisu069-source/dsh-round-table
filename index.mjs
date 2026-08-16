// round-table Node half：房间/角色账本 + 讨论编排器（手动/全体/接力、轮次上限、暂停）+ HTTP 路由 + SSE。
// 契约：官方 bundle 插件 Node half（完整 Cordis 插件，仓库根 package.json 的 dsh.bundle/dsh.client）。
// 设计决策：D1 统一模型、D2 页面离开默认暂停、D3 文本卡片总结、D4 插件名 round-table、D5 用户自建角色。
// 状态机与账本为纯逻辑（lib/src/state.mjs，可单测）；本文件只做宿主接线（服务、路由、事件）。
// 安全：/interact 类写接口校验跨源（CSRF）；body 上限 1KB。
// 持久化：<dshHome>/data/round-table/state.json（原子写，1s 防抖）。
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createRole, createRoom, upsertRole, removeRole, addMember, removeMember,
  setMemberStatus, appendMessage, setMode, setPaused, setMaxRounds, buildQueue, advance } from './lib/src/state.mjs'
import { NAMESPACE, DEFAULTS, normalizeConfig } from './lib/src/config.mjs'
import { loadState, saveState, stateFilePath } from './lib/src/persistence.mjs'
import { firstUserMessageText, sessionDisplayTitle } from './lib/src/titles.mjs'

export const name = 'round-table'
export const inject = ['settings', 'webServer', 'agents', 'sessions', 'jobs']

export const ROUTE_PREFIX = '/round-table'
export const STATE_PATH = `${ROUTE_PREFIX}/state`
export const EVENTS_PATH = `${ROUTE_PREFIX}/events`
export const BODY_LIMIT = 1024

/** 最后兜底：无 dshHomePath 服务且无 DSH_HOME 环境变量时，从模块位置向上找宿主根。 */
function resolveHomeFallback() {
  return new URL('../../..', import.meta.url).pathname
}

/**
 * 构造注入给 agent 的用户消息（对齐官方 session.prompt 的消息形状与
 * dsh-session assertMessageEventShape 校验：id/role/source/content）。
 * 不 import @deepseek-ai/dsh-llm 的 createUserMessage——保持插件零 @deepseek-ai 依赖，
 * 任何安装方式（git 源/本地 link/符号链接）都可解析（官方包由 profile pnpm 闭包注入）。
 * @param {string} text 消息文本
 * @param {string} rpcId 归属标识（round-table:roomId:memberId）
 */
function buildUserMessage(text, rpcId) {
  return {
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text }],
    source: { kind: 'user', rpcId },
  }
}

export function apply(ctx) {
  // 状态文件路径：优先取宿主注入的 dshHomePath 服务（实测服务器进程内 DSH_HOME 为 undefined，
  // 模块级回退会算错路径——曾算出 /Users/data/round-table 导致 EACCES，房间/角色从未落盘）。
  // 兼容新旧 API：dsh 0.1.0-rc.6 起注入的是函数 dshHomePath(...segments)（无参调用返回
  // ~/.dsh 绝对路径），旧版注入字符串；统一归一化为字符串后再交给 stateFilePath 拼接，
  // 避免 path.join 收到 function 抛 ERR_INVALID_ARG_TYPE。
  const dshHomeRaw = (typeof ctx.get === 'function' ? ctx.get('dshHomePath') : undefined)
    ?? process.env.DSH_HOME
    ?? resolveHomeFallback()
  let harnessHome
  try {
    harnessHome = typeof dshHomeRaw === 'function' ? dshHomeRaw() : dshHomeRaw
  } catch {
    // 服务函数调用异常 → 回退环境变量/模块兜底，不阻断插件加载
    harnessHome = process.env.DSH_HOME ?? resolveHomeFallback()
  }
  const stateFile = stateFilePath(harnessHome)
  // 启动诊断：记录实际使用的状态路径（写 /tmp，不影响宿主）
  try {
    appendFileSync('/tmp/round-table-persist.log', `${new Date().toISOString()} apply dshHomePath=${JSON.stringify(harnessHome)} statePath=${stateFile}\n`)
  } catch { /* 诊断日志失败则静默 */ }

  // ---- 状态账本 ----
  let state = loadState(stateFile) ?? { roles: [], rooms: [] }
  let configRef = { ...DEFAULTS }
  let configRevision = 0
  const saveTimer = null

  // 配置（settings 服务条件接入；失败回退 DEFAULTS）
  const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  if (settings !== undefined && typeof settings.register === 'function') {
    try {
      const scope = settings.register(NAMESPACE, { type: 'object' }, { applies: 'live', validate: normalizeConfig })
      configRef = scope.get()
      scope.watch((next) => {
        configRef = next
        configRevision += 1
      })
    } catch {
      // register 失败 → 保持 DEFAULTS
    }
  }

  // 落盘防抖
  let scheduleTimer = null
  const scheduleSave = () => {
    clearTimeout(scheduleTimer)
    scheduleTimer = setTimeout(() => saveState(stateFile, state), 1000)
  }
  const mutate = (fn) => {
    state = fn(state)
    scheduleSave()
    broadcast()
  }

  // ---- SSE 广播（讨论状态变化即时通知 client）----
  const sseClients = new Set()
  const broadcast = () => {
    const line = 'data: {"type":"changed"}\n\n'
    for (const res of sseClients) {
      try { res.write(line) } catch { sseClients.delete(res) }
    }
  }

  // ---- 工具 ----
  const json = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra })
    res.end(JSON.stringify(body))
  }
  const isCrossOrigin = (headers, host) => {
    const origin = headers.origin ?? headers.referer
    if (!origin) return false
    try {
      return new URL(origin).host !== host
    } catch {
      return true
    }
  }
  async function readBody(req, limit = BODY_LIMIT) {
    let data = ''
    for await (const chunk of req) {
      data += chunk
      if (data.length > limit) return null
    }
    return data
  }

  const roomById = (rooms, id) => rooms.find((r) => r.id === id)
  const roleById = (roles, id) => roles.find((r) => r.id === id)

  // ---- 讨论驱动器（真实 Agent 接线，对齐 dsh-host-apiproxy session.prompt 官方模式）----
  // 成员类型（kind）：
  // - 'role'：插件自建 agent（会话 id = round-table:${roomId}:${memberId}），人设经注入消息合成（D5）
  // - 'session'：工作区既有对话框（会话 id = member.sessionId），以它自己的上下文/记忆参与（新功能）
  // 驱动步骤：
  //   1. 解析 agent：live（ctx.agents.get）优先；冷会话 resume（session 成员）或 create（role 成员）
  //   2. createUserMessage({ content: [{type:'text',text:prompt}], source: {kind:'user', rpcId} })
  //   3. agent.followup(message)（队列模式，不打断该会话自身正在进行的回合）
  //   4. session/event 的 turn/end 回读 assistant/message → settleSpeaker 写入时间线并推进队列
  // 失败路径：deliver 抛错（解析/注入失败）→ 立即落失败消息；turn/end 无文本/错误 → 落失败消息；超时兜底。
  const pendingTurns = new Map() // sessionId -> { roomId, memberId, sinceSeq, timer }

  const resolveDefaultModel = () => {
    try {
      const ns = typeof settings?.get === 'function' ? settings.get('agent-default-model') : undefined
      if (ns && typeof ns.provider === 'string' && typeof ns.model === 'string') {
        return { provider: ns.provider, model: ns.model }
      }
    } catch { /* 缺省模型不可解析 */ }
    return undefined
  }

  const getLiveAgent = (sessionId) => (typeof ctx.agents?.get === 'function' ? ctx.agents.get(sessionId) : undefined)

  /** session 成员：复用 live agent，否则恢复既有会话（官方 agentFor 同构）。
   *  resume 须带 agentOptions（默认模型）——否则 prompt 变量 {{model}}/{{provider}} 无值，
   *  turn 以 error 结束（实测踩坑，与 role 成员同因）。会话自身的模型选择仍经
   *  request/header 驱动实际调用，agentOptions 只满足 prompt 组装。 */
  const sessionAgent = async (sessionId) => {
    const live = getLiveAgent(sessionId)
    if (live !== undefined) return live
    const model = resolveDefaultModel()
    const options = { resumeSessionId: sessionId }
    if (model !== undefined) options.agentOptions = { ...model }
    const resumed = await ctx.agents.resume(options)
    return resumed.agent
  }

  /** role 成员：复用/创建插件自建 agent（统一模型 D1：沿用 agent-default-model 配置）。 */
  const roleAgent = async (roomId, memberId) => {
    const sessionId = `round-table:${roomId}:${memberId}`
    const live = getLiveAgent(sessionId)
    if (live !== undefined) return live
    const model = resolveDefaultModel()
    if (model === undefined) throw new Error('未配置默认模型（settings 的 agent-default-model 缺失）')
    // ctx.agents.create 的 loop 选项（provider/model）须置于 agentOptions（createAgent 契约——
    // 实测放顶层会被丢弃，导致 prompt 变量 {{model}}/{{provider}} 无值、turn 以 error 结束）；
    // cwd 走 meta（对齐主会话工作区）。
    return (await ctx.agents.create({
      sessionId,
      agentOptions: { ...model },
      meta: { cwd: process.cwd() },
    })).agent
  }

  const memberDisplay = (member) => {
    if (member.kind === 'session') return { name: member.title ?? member.sessionId ?? member.id, color: '#7c8fe8' }
    const role = roleById(state.roles, member.roleId)
    return { name: role?.name ?? member.id, color: role?.color }
  }

  // 成员发言注入：session 成员不注入角色卡（它自己的会话上下文即人设）
  const composeMemberPrompt = (room, member) => {
    const question = room.pendingQuestion ?? '（议题待定）'
    const recent = 5
    const context = room.messages.slice(-recent).map((m) => {
      const who = m.kind === 'user' ? '用户' : m.authorName ?? m.authorId ?? '未知'
      return `[${who}] ${m.text}`
    }).join('\n')
    const head = member.kind === 'session'
      ? `【圆桌讨论邀请】你被邀请加入多方讨论房间「${room.title}」，请以你自己的身份、基于你自己的上下文与记忆参与。`
      : null
    const persona = member.kind === 'role' ? (() => {
      const role = roleById(state.roles, member.roleId)
      return [
        `# 角色卡（你的身份设定）`,
        `名称：${role?.name ?? member.id}`,
        role?.systemPrompt ? `System Prompt：${role.systemPrompt}` : null,
        role?.personality ? `性格参数：${role.personality}` : null,
      ].filter((l) => l !== null).join('\n')
    })() : null
    return [
      head,
      persona,
      `# 房间上下文（近 ${recent} 条讨论）`,
      context || '（暂无历史）',
      `# 本轮议题`,
      question,
      member.kind === 'session' ? `请给出你的看法（可补充、质疑或修正其他成员的观点），回复后结束。` : null,
    ].filter((l) => l !== null).join('\n')
  }

  // 记录一条成员发言到时间线并推进队列（由 turn/end 捕获或失败路径调用）
  const settleSpeaker = (roomId, memberId, text, status) => {
    const room = roomById(state.rooms, roomId)
    if (!room) return
    const member = room.members.find((m) => m.id === memberId)
    const { name, color } = memberDisplay(member ?? { id: memberId, kind: 'role' })
    const withMsg = appendMessage(room, {
      kind: 'agent',
      authorId: memberId,
      authorName: name,
      color,
      text,
      round: room.round + 1,
    })
    const after = advance(setMemberStatus(withMsg, memberId, status))
    mutate((s) => ({ ...s, rooms: s.rooms.map((r) => r.id === roomId ? after.room : r) }))
    if (after.nextSpeaker !== null && !after.room.paused && after.room.running) void pump(roomId)
  }

  const driver = {
    /** 注入发言卡并唤醒 turn（队列模式）；回复经 turn/end 异步回读。 */
    async deliver(room, member) {
      const sessionId = member.kind === 'session'
        ? member.sessionId
        : `round-table:${room.id}:${member.id}`
      const agent = member.kind === 'session'
        ? await sessionAgent(sessionId)
        : await roleAgent(room.id, member.id)
      if (agent === undefined || typeof agent.followup !== 'function') {
        throw new Error('目标会话无可用 agent（followup 不可用）')
      }
      const message = buildUserMessage(composeMemberPrompt(room, member), `round-table:${room.id}:${member.id}`)
      const session = typeof ctx.sessions?.get === 'function' ? ctx.sessions.get(sessionId) : undefined
      const sinceSeq = Array.isArray(session?.events) ? session.events.length : 0
      const timer = setTimeout(() => {
        if (!pendingTurns.has(sessionId)) return
        pendingTurns.delete(sessionId)
        settleSpeaker(room.id, member.id, '（该成员发言超时，未在时限内产出回复）', 'error')
      }, 120000)
      pendingTurns.set(sessionId, { roomId: room.id, memberId: member.id, sinceSeq, timer })
      agent.followup(message)
      return { queued: true }
    },
  }

  // 推进讨论：弹出队首成员 → 注入发言 → 等待 turn/end 异步回读（暂停/上限即时检查）
  const pump = async (roomId) => {
    const room = roomById(state.rooms, roomId)
    if (!room || room.paused || !room.running || room.queue.length === 0) return
    const memberId = room.queue[0]
    const member = room.members.find((m) => m.id === memberId)
    if (!member) {
      const after = advance(room)
      mutate((s) => ({ ...s, rooms: s.rooms.map((r) => r.id === roomId ? after.room : r) }))
      return pump(roomId)
    }
    mutate((s) => ({
      ...s,
      rooms: s.rooms.map((r) => r.id === roomId ? setMemberStatus(r, memberId, 'thinking') : r),
    }))
    try {
      await driver.deliver(room, member)
    } catch (error) {
      settleSpeaker(roomId, memberId, `（该成员发言失败：${String(error?.message ?? error)}）`, 'error')
    }
  }

  // 回合完成回读：驱动链的异步落点（session/event 对全会话可见，pending 限定归属）
  ctx.on('session/event', (session, event) => {
    const pending = session !== null && typeof session === 'object' ? pendingTurns.get(session.id) : undefined
    if (pending === undefined) return
    if (event === null || typeof event !== 'object' || event.type !== 'turn/end') return
    clearTimeout(pending.timer)
    pendingTurns.delete(session.id)
    const events = Array.isArray(session?.events) ? session.events : []
    let text = null
    for (const e of events) {
      if (typeof e?.seq !== 'number' || e.seq < pending.sinceSeq) continue
      if (e.type !== 'assistant/message') continue
      const msg = e.data?.message
      const block = Array.isArray(msg?.content) ? msg.content.find((b) => b?.type === 'text') : undefined
      if (block !== undefined && typeof block.text === 'string' && block.text.length > 0) text = block.text
    }
    const reason = event.data?.reason?.kind
    const failed = reason === 'error' || reason === 'aborted' || text === null
    settleSpeaker(pending.roomId, pending.memberId, failed ? `（该成员本轮未产出回复${reason ? `：${reason}` : ''}）` : text, failed ? 'error' : 'idle')
  })

  const startDiscussion = (roomId, question, mode, mentions) => {
    let room = roomById(state.rooms, roomId)
    if (!room) return
    const nextMode = mode ?? room.mode
    const withQuestion = appendMessage(room, {
      kind: 'user', text: question,
    })
    const withMode = setMode(withQuestion, nextMode)
    const queue = buildQueue(withMode, mentions ?? [])
    if (queue.length === 0) {
      mutate((s) => ({ ...s, rooms: s.rooms.map((r) => r.id === roomId ? withMode : r) }))
      return
    }
    const started = { ...withMode, pendingQuestion: question, queue, running: true, paused: false }
    mutate((s) => ({ ...s, rooms: s.rooms.map((r) => r.id === roomId ? started : r) }))
    void pump(roomId)
  }

  // ---- 路由（webServer 可选，headless 降级为无 UI 工具插件）----
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  ctx.effect(() => {
    const disposers = [
      webServer !== undefined ? [
        webServer.register({
          kind: 'exact', path: STATE_PATH,
          handler: async (req, res) => {
            if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed; use GET' }, { allow: 'GET' })
            json(res, 200, {
              config: configRef, configRevision,
              roles: state.roles,
              rooms: state.rooms,
            }, { 'cache-control': 'no-store' })
          },
        }),
        webServer.register({
          kind: 'exact', path: `${ROUTE_PREFIX}/roles`,
          handler: async (req, res) => {
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
            if (isCrossOrigin(req.headers, req.headers.host)) return json(res, 403, { error: 'cross-origin request rejected' })
            const raw = await readBody(req)
            if (raw === null) return json(res, 413, { error: 'request body too large' })
            let body
            try { body = JSON.parse(raw || '{}') } catch { return json(res, 400, { error: 'invalid JSON body' }) }
            if (!body.name) return json(res, 400, { error: 'name is required' })
            const role = createRole({ id: `role-${randomUUID()}`, ...body })
            mutate((s) => ({ ...s, roles: upsertRole(s.roles, role) }))
            json(res, 200, { role })
          },
        }),
        webServer.register({
          kind: 'exact', path: `${ROUTE_PREFIX}/rooms`,
          handler: async (req, res) => {
            try {
              if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
              if (isCrossOrigin(req.headers, req.headers.host)) return json(res, 403, { error: 'cross-origin request rejected' })
              const raw = await readBody(req)
              if (raw === null) return json(res, 413, { error: 'request body too large' })
              let body
              try { body = JSON.parse(raw || '{}') } catch { return json(res, 400, { error: 'invalid JSON body' }) }
              if (!body.title) return json(res, 400, { error: 'title is required' })
              let room = createRoom({
                id: `room-${randomUUID()}`,
                title: body.title,
                mode: body.mode ?? configRef.defaultMode,
                maxRounds: body.maxRounds ?? configRef.maxRounds,
              })
              for (const roleId of body.memberRoleIds ?? []) {
                if (roleById(state.roles, roleId)) room = addMember(room, { id: `member-${randomUUID()}`, roleId })
              }
              mutate((s) => ({ ...s, rooms: [...s.rooms, room] }))
              json(res, 200, { room })
            } catch (error) {
              json(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        webServer.register({
          kind: 'exact', path: `${ROUTE_PREFIX}/members`,
          handler: async (req, res) => {
            try {
              if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
              if (isCrossOrigin(req.headers, req.headers.host)) return json(res, 403, { error: 'cross-origin request rejected' })
              const raw = await readBody(req)
              if (raw === null) return json(res, 413, { error: 'request body too large' })
              let body
              try { body = JSON.parse(raw || '{}') } catch { return json(res, 400, { error: 'invalid JSON body' }) }
              const room = roomById(state.rooms, body.roomId)
              if (!room) return json(res, 404, { error: 'room not found' })
              let next
              if (body.sessionId !== undefined) {
                // 工作区既有对话框：会话成员（kind: 'session'）；空 id 拒绝（防脏数据）
                if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
                  return json(res, 400, { error: 'sessionId is required' })
                }
                // 同一会话去重
                if (room.members.some((m) => m.sessionId === body.sessionId)) {
                  return json(res, 409, { error: '该会话已是房间成员' })
                }
                let title = body.title
                if (typeof title !== 'string' || title.length === 0) {
                  try {
                    const svc = ctx.get('sessions')
                    const found = typeof svc?.list === 'function' ? svc.list().find((s) => s?.id === body.sessionId) : undefined
                    title = typeof found?.header?.title === 'string' && found.header.title ? found.header.title : body.sessionId
                  } catch {
                    title = body.sessionId
                  }
                }
                next = addMember(room, { id: `member-${randomUUID()}`, kind: 'session', sessionId: body.sessionId, title })
              } else {
                if (!body.roleId || !roleById(state.roles, body.roleId)) return json(res, 400, { error: 'valid roleId is required' })
                next = addMember(room, { id: `member-${randomUUID()}`, roleId: body.roleId })
              }
              mutate((s) => ({ ...s, rooms: s.rooms.map((r) => r.id === body.roomId ? next : r) }))
              json(res, 200, { room: next })
            } catch (error) {
              json(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        webServer.register({
          kind: 'exact', path: `${ROUTE_PREFIX}/sessions`,
          handler: async (req, res) => {
            try {
              if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed; use GET' }, { allow: 'GET' })
              const sessions = []
              const pushSession = (id, title, cwd, updatedAt) => {
                if (sessions.some((x) => x.id === id)) return
                sessions.push({ id, title, cwd, updatedAt })
              }
              try {
                // 1) 持久化层：列出所有已存在会话（含侧边栏里未打开的对话框）
                const persistence = ctx.get('sessionPersistence')
                if (persistence !== undefined && typeof persistence.list === 'function') {
                  const headers = await persistence.list()
                  for (const header of headers) {
                    if (header === null || typeof header !== 'object' || typeof header.id !== 'string') continue
                    if (header.id.startsWith('round-table:') || header.origin === 'subagent') continue
                    let title = typeof header.title === 'string' && header.title ? header.title : null
                    if (title === null) {
                      try {
                        const inspected = await persistence.inspect(header.id)
                        title = firstUserMessageText({ events: inspected?.events })
                      } catch { /* inspect 失败跳过标题兜底 */ }
                    }
                    if (title === null) {
                      const when = typeof header.createdAt === 'number'
                        ? new Date(header.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : null
                      title = when !== null ? `对话 ${when}` : header.id
                    }
                    pushSession(header.id, title, header.cwd, typeof header.createdAt === 'number' ? header.createdAt : Date.now())
                  }
                }
                // 2) 活会话补充（刚创建尚未落盘的）
                const svc = ctx.get('sessions')
                if (svc !== undefined && typeof svc.list === 'function') {
                  for (const s of svc.list()) {
                    if (s === null || typeof s !== 'object' || typeof s.id !== 'string') continue
                    if (s.id.startsWith('round-table:')) continue
                    pushSession(s.id, sessionDisplayTitle(s), s.header?.cwd, typeof s.header?.createdAt === 'number' ? s.header.createdAt : Date.now())
                  }
                }
              } catch { /* 列表异常 → 空 */ }
              // 按文件夹（cwd）分组
              const byFolder = new Map()
              for (const s of sessions) {
                const folder = s.cwd ?? '（未知位置）'
                if (!byFolder.has(folder)) byFolder.set(folder, [])
                byFolder.get(folder).push(s)
              }
              const folders = [...byFolder.entries()].map(([path, list]) => ({ path, sessions: list }))
              json(res, 200, { folders }, { 'cache-control': 'no-store' })
            } catch (error) {
              json(res, 500, { error: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
        webServer.register({
          kind: 'exact', path: `${ROUTE_PREFIX}/messages`,
          handler: async (req, res) => {
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
            if (isCrossOrigin(req.headers, req.headers.host)) return json(res, 403, { error: 'cross-origin request rejected' })
            const raw = await readBody(req)
            if (raw === null) return json(res, 413, { error: 'request body too large' })
            let body
            try { body = JSON.parse(raw || '{}') } catch { return json(res, 400, { error: 'invalid JSON body' }) }
            if (!roomById(state.rooms, body.roomId)) return json(res, 404, { error: 'room not found' })
            if (!body.text || typeof body.text !== 'string') return json(res, 400, { error: 'text is required' })
            startDiscussion(body.roomId, body.text, body.mode, Array.isArray(body.mentions) ? body.mentions : [])
            json(res, 200, { ok: true })
          },
        }),
        webServer.register({
          kind: 'exact', path: `${ROUTE_PREFIX}/control`,
          handler: async (req, res) => {
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
            if (isCrossOrigin(req.headers, req.headers.host)) return json(res, 403, { error: 'cross-origin request rejected' })
            const raw = await readBody(req)
            if (raw === null) return json(res, 413, { error: 'request body too large' })
            let body
            try { body = JSON.parse(raw || '{}') } catch { return json(res, 400, { error: 'invalid JSON body' }) }
            const room = roomById(state.rooms, body.roomId)
            if (!room) return json(res, 404, { error: 'room not found' })
            let next = room
            switch (body.action) {
              case 'pause': next = setPaused(room, true); break
              case 'resume':
                next = setPaused(room, false)
                if (next.running && next.queue.length > 0) void pump(body.roomId)
                break
              case 'setRounds': next = setMaxRounds(room, body.value); break
              case 'setMode': next = setMode(room, body.value); break
              case 'summarize': {
                const text = room.messages.map((m) => {
                  const who = m.kind === 'user' ? '用户' : m.authorName ?? m.authorId
                  return `[${who}] ${m.text}`
                }).join('\n')
                const summary = { id: `sum-${randomUUID()}`, text: text ? `（骨架总结：以下为讨论原始记录，真实总结者 Agent 待接线）\n${text}` : '（房间暂无讨论内容）', ts: Date.now(), by: 'summarizer' }
                next = { ...room, summaries: [...room.summaries, summary] }
                break
              }
              default: return json(res, 400, { error: `unknown action: ${body.action}` })
            }
            mutate((s) => ({ ...s, rooms: s.rooms.map((r) => r.id === body.roomId ? next : r) }))
            json(res, 200, { room: next })
          },
        }),
        webServer.register({
          kind: 'exact', path: `${ROUTE_PREFIX}/presence`,
          handler: async (req, res) => {
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
            if (isCrossOrigin(req.headers, req.headers.host)) return json(res, 403, { error: 'cross-origin request rejected' })
            const raw = await readBody(req)
            if (raw === null) return json(res, 413, { error: 'request body too large' })
            let body
            try { body = JSON.parse(raw || '{}') } catch { return json(res, 400, { error: 'invalid JSON body' }) }
            const room = roomById(state.rooms, body.roomId)
            if (!room) return json(res, 404, { error: 'room not found' })
            // D2：页面离开默认暂停（可配置后台继续）
            if (body.visible === false && configRef.pauseOnPageLeave && room.running && !room.paused) {
              const next = setPaused(room, true)
              mutate((s) => ({ ...s, rooms: s.rooms.map((r) => r.id === body.roomId ? next : r) }))
            }
            json(res, 200, { ok: true })
          },
        }),
        webServer.register({
          kind: 'exact', path: EVENTS_PATH,
          handler: async (req, res) => {
            if (req.method !== 'GET') {
              res.writeHead(405); res.end(); return
            }
            res.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
              'x-accel-buffering': 'no',
            })
            if (typeof res.flushHeaders === 'function') res.flushHeaders()
            res.write('retry: 3000\n\n')
            sseClients.add(res)
            let heartbeat = null
            if (typeof res.on === 'function') {
              res.on('close', () => {
                clearInterval(heartbeat)
                sseClients.delete(res)
              })
            }
            heartbeat = setInterval(() => {
              try { res.write(': ping\n\n') } catch { /* 断连由 close 清理 */ }
            }, 25000)
          },
        }),
      ] : [],
    ]
    return () => {
      clearTimeout(scheduleTimer)
      saveState(stateFile, state) // 末次落盘
      for (const dispose of disposers) dispose()
    }
  }, 'round-table: state/roles/rooms/control routes + events')
}
