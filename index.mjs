// round-table Node half：角色账本 + @ 提及 → 单角色扮演 / 多角色真讨论（v2 P0）。
// 契约：官方 bundle 插件 Node half（完整 Cordis 插件）。
// v2 P0：
// - 单角色 @：主会话 assemble 注入角色卡 + 纯文本强制（禁止工具，防烧 token）。
// - 多角色 @：round-table 驱动各角色**独立 agent 会话**接力（A 输出作为 B 上下文，
//   每个角色独立推理，仅一轮），全部回复后经主会话 followup 触发汇总输出（主持人收敛）。
// - 成本护栏：所有注入均纯文本；SOUL 2000 字截断；讨论 120s 超时。
// 关键机制（官方 API）：
// - ctx.on('system-prompt/assemble')：AssembleContext.scope 即 agent（agent.id=SessionId）。
// - ctx.on('session/event')：user/message 检测多角色 @ 启动讨论；turn/end 回读角色回复。
// - ctx.agents.create/get + agent.followup：驱动角色独立会话（v1 rooms 编排器验证过的路径）。
// - agent.inject/followup：主会话汇总触发（无需官方"写回"API）。
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createRole, upsertRole, migrateState } from './lib/src/state.mjs'
import { NAMESPACE, DEFAULTS, normalizeConfig } from './lib/src/config.mjs'
import { loadState, saveState, stateFilePath } from './lib/src/persistence.mjs'
import {
  parseMentions, matchRoles, composeSingleRoleSection, composeMultiWaitSection,
  composeRolePrompt, composeSummaryPrompt,
} from './lib/src/mentions.mjs'

export const name = 'round-table'
export const inject = ['settings', 'webServer', 'agents']

export const ROUTE_PREFIX = '/round-table'
export const STATE_PATH = `${ROUTE_PREFIX}/state`
export const EVENTS_PATH = `${ROUTE_PREFIX}/events`
export const BODY_LIMIT = 1024

/** 讨论整体超时（防卡死）与单个角色发言超时（ms）。 */
const DISCUSSION_TIMEOUT = 120000
const SPEAKER_TIMEOUT = 90000
const MAX_ROLES_PER_DISCUSSION = 4

/** 最后兜底：无 dshHomePath 服务且无 DSH_HOME 环境变量时，从模块位置向上找宿主根。 */
function resolveHomeFallback() {
  return new URL('../../..', import.meta.url).pathname
}

/** 从会话事件流提取最新一条 user/message 的文本（含 @ 提及的原始文本）。 */
function latestUserMessageText(session) {
  const events = Array.isArray(session?.events) ? session.events : []
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e === null || typeof e !== 'object' || e.type !== 'user/message') continue
    const data = e.data
    const msg = data !== null && typeof data === 'object' && data.message ? data.message : data
    const content = Array.isArray(msg?.content) ? msg.content : []
    const block = content.find((b) => b !== null && typeof b === 'object' && b.type === 'text')
    if (block !== null && typeof block?.text === 'string' && block.text.trim().length > 0) {
      return block.text
    }
  }
  return null
}

/** 提取 user/message 事件的文本。 */
function eventUserText(event) {
  if (event === null || typeof event !== 'object') return null
  const data = event.data
  const msg = data !== null && typeof data === 'object' && data.message ? data.message : data
  const content = Array.isArray(msg?.content) ? msg.content : []
  const block = content.find((b) => b !== null && typeof b === 'object' && b.type === 'text')
  return block !== null && typeof block?.text === 'string' && block.text.trim().length > 0 ? block.text : null
}

/** 从会话事件流提取 sinceSeq 之后最后一条 assistant/message 的文本（turn/end 回读）。 */
function assistantTextSince(session, sinceSeq) {
  const events = Array.isArray(session?.events) ? session.events : []
  let text = null
  for (const e of events) {
    if (typeof e?.seq !== 'number' || e.seq < sinceSeq) continue
    if (e.type !== 'assistant/message') continue
    const msg = e.data?.message
    const block = Array.isArray(msg?.content) ? msg.content.find((b) => b?.type === 'text') : undefined
    if (block !== undefined && typeof block.text === 'string' && block.text.length > 0) text = block.text
  }
  return text
}

/** 构造注入给 agent 的用户消息（对齐官方 session.prompt 消息形状）。 */
function buildUserMessage(text, rpcId) {
  return {
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text }],
    source: { kind: 'user', rpcId },
  }
}

export function apply(ctx) {
  // 状态文件路径（兼容新旧 dshHomePath API，失败回退环境变量/模块兜底）
  const dshHomeRaw = (typeof ctx.get === 'function' ? ctx.get('dshHomePath') : undefined)
    ?? process.env.DSH_HOME
    ?? resolveHomeFallback()
  let harnessHome
  try {
    harnessHome = typeof dshHomeRaw === 'function' ? dshHomeRaw() : dshHomeRaw
  } catch {
    harnessHome = process.env.DSH_HOME ?? resolveHomeFallback()
  }
  const stateFile = stateFilePath(harnessHome)
  try {
    appendFileSync('/tmp/round-table-persist.log', `${new Date().toISOString()} apply dshHomePath=${JSON.stringify(harnessHome)} statePath=${stateFile}\n`)
  } catch { /* 诊断日志失败则静默 */ }

  // ---- 状态账本 ----
  let state = migrateState(loadState(stateFile) ?? { roles: [], rooms: [] })
  let configRef = { ...DEFAULTS }
  let configRevision = 0

  const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  if (settings !== undefined && typeof settings.register === 'function') {
    try {
      const scope = settings.register(NAMESPACE, { type: 'object' }, { applies: 'live', validate: normalizeConfig })
      configRef = scope.get()
      scope.watch((next) => { configRef = next; configRevision += 1 })
    } catch {
      // register 失败 → 保持 DEFAULTS
    }
  }

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

  // ---- SSE 广播 ----
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

  // ---- v2 真讨论编排器 ----
  const log = (line) => {
    try {
      appendFileSync('/tmp/round-table-persist.log', `${new Date().toISOString()} ${line}\n`)
    } catch { /* 诊断日志失败则静默 */ }
  }
  log('plugin loaded OK (v2)')
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

  /**
   * 角色独立会话：live 优先；已持久化的会话走 resume（实测 create 对已存在 sessionId
   * 会空转——turn 立即 end 且无输出），不存在的会话才 create。
   */
  const roleAgent = async (roleId) => {
    const sessionId = `round-table:role-${roleId}`
    const live = getLiveAgent(sessionId)
    if (live !== undefined) return live
    const model = resolveDefaultModel()
    if (model === undefined) throw new Error('未配置默认模型（settings 的 agent-default-model 缺失）')
    const agentOptions = { ...model }
    // 先试 resume（会话已持久化）；失败（如不存在）再 create
    if (typeof ctx.agents?.resume === 'function') {
      try {
        const resumed = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions })
        return resumed.agent
      } catch { /* 会话不存在或其他 → 走 create */ }
    }
    const created = await ctx.agents.create({
      sessionId,
      agentOptions,
      meta: { cwd: process.cwd() },
    })
    return created.agent
  }

  // 讨论运行表：主会话 id → { msgId, question, matched, replies, timer, done }
  const discussionRuns = new Map()
  // 待回读的角色发言：角色会话 id → { run, role, sinceSeq, timer }
  const pendingTurns = new Map()
  // 最近一条用户消息缓存（assemble 时读它——实测 assemble 时读 session.events 拿到的是
  // "Current runtime context" 快照而非用户消息，session/event 路径提取才可靠）
  const lastUserTextBySession = new Map()

  const startDiscussion = (parentSessionId, msgId, question, matched) => {
    if (discussionRuns.has(parentSessionId)) return // 已有进行中讨论
    const run = { msgId, question, matched, replies: [], timer: null, done: false }
    discussionRuns.set(parentSessionId, run)
    run.timer = setTimeout(() => {
      if (run.done) return
      run.done = true
      discussionRuns.delete(parentSessionId)
      log(`discussion timeout parent=${parentSessionId} msg=${msgId}`)
    }, DISCUSSION_TIMEOUT)
    void driveNext(run)
  }

  /** 推进讨论：按顺序驱动下一位角色（独立会话 + 独立推理）。 */
  const driveNext = async (run) => {
    if (run.done) return
    const idx = run.replies.length
    if (idx >= run.matched.length) {
      finishDiscussion(run)
      return
    }
    const role = run.matched[idx]
    try {
      const agent = await roleAgent(role.id)
      const prompt = composeRolePrompt(run, role, idx)
      const sessionId = agent.id
      const sinceSeq = Array.isArray(agent.session?.events) ? agent.session.events.length : 0
      log(`driveNext role=${role.name} agent=${sessionId} sinceSeq=${sinceSeq}`)
      const timer = setTimeout(() => {
        if (run.done) return
        run.replies.push(`（${role.name} 未在时限内回复）`)
        void driveNext(run)
      }, SPEAKER_TIMEOUT)
      pendingTurns.set(sessionId, { run, role, sinceSeq, timer })
      agent.followup(buildUserMessage(prompt, `round-table:disc:${run.msgId}`))
      log(`followup sent role=${role.name}`)
    } catch (error) {
      log(`driveNext FAIL role=${role.name} err=${String(error?.message ?? error)}`)
      run.replies.push(`（${role.name} 发言失败：${String(error?.message ?? error)}）`)
      void driveNext(run)
    }
  }

  /** 全部角色回复后：注入主会话并触发汇总（主持人收敛）。 */
  const finishDiscussion = (run) => {
    if (run.done) return
    run.done = true
    clearTimeout(run.timer)
    // 从 pendingTurns 清理本 run 的残留
    for (const [sid, p] of pendingTurns) {
      if (p.run === run) { clearTimeout(p.timer); pendingTurns.delete(sid) }
    }
    // 找到该讨论对应的主会话 id（run 没存 parentSessionId，从 discussionRuns 反查）
    let parentSessionId = null
    for (const [sid, r] of discussionRuns) {
      if (r === run) { parentSessionId = sid; break }
    }
    discussionRuns.delete(parentSessionId)
    const parent = parentSessionId !== null ? getLiveAgent(parentSessionId) : undefined
    if (parent === undefined || typeof parent.followup !== 'function') {
      log(`finishDiscussion: parent agent unavailable (${parentSessionId})`)
      return
    }
    if (run.replies.length === 0) return
    const summary = composeSummaryPrompt(run.replies)
    try {
      parent.followup(buildUserMessage(summary, `round-table:disc:${run.msgId}:summary`))
      log(`discussion finished parent=${parentSessionId} roles=${run.matched.map((r) => r.name).join(',')}`)
    } catch (error) {
      log(`finishDiscussion followup FAIL err=${String(error?.message ?? error)}`)
    }
  }

  // ---- session/event：多角色 @ 检测 + 角色发言回读 ----
  ctx.on('session/event', (session, event) => {
    const sessionId = typeof session?.id === 'string' ? session.id : null
    if (sessionId === null) return

    // 1) 角色会话 turn/end 回读（pendingTurns 归属）
    if (sessionId.startsWith('round-table:role-')) {
      const pending = pendingTurns.get(sessionId)
      if (pending !== undefined && event !== null && typeof event === 'object' && event.type === 'turn/end') {
        clearTimeout(pending.timer)
        pendingTurns.delete(sessionId)
        const text = assistantTextSince(session, pending.sinceSeq)
        pending.run.replies.push(text ? `${pending.role.name}：${text}` : `（${pending.role.name} 本轮未产出回复）`)
        log(`role turn/end replied role=${pending.role.name} replies=${pending.run.replies.length}`)
        void driveNext(pending.run)
      }
      return
    }

    // 2) 主会话 user/message：检测多角色 @ → 启动真讨论
    if (event !== null && typeof event === 'object' && event.type === 'user/message') {
      const text = eventUserText(event)
      if (text !== null) lastUserTextBySession.set(sessionId, text)
      const matched = matchRoles(state.roles, parseMentions(text))
      if (matched.length >= 2 && !discussionRuns.has(sessionId)) {
        const msgId = typeof event.seq === 'number' ? String(event.seq) : (event.data?.id ?? randomUUID())
        log(`START discussion roles=${matched.map((r) => r.name).join(',')}`)
        startDiscussion(sessionId, msgId, text, matched.slice(0, MAX_ROLES_PER_DISCUSSION))
      }
    }
  }, 'round-table: discussion orchestration')

  // ---- system-prompt/assemble：单角色扮演 / 多角色等待 ----
  // 工具策略（用户决策：放开角色用宿主工具）：
  // - 单角色 @：放开工具（模型以角色身份 + 可用宿主工具读代码/干活）
  // - 多角色 @：主会话**清空 tools**（协调等待阶段不允许干活，防 Deep diving；
  //   真正的工具放开在各角色的独立会话——见 composeRolePrompt）
  ctx.on('system-prompt/assemble', (assembly, context, next) => {
    try {
      const agent = context?.scope
      const sessionId = agent?.id
      if (typeof sessionId === 'string' && !sessionId.startsWith('round-table:')) {
        const text = lastUserTextBySession.get(sessionId) ?? latestUserMessageText(agent?.session)
        const matched = matchRoles(state.roles, parseMentions(text))
        if (matched.length === 1) {
          log(`assemble single role=${matched[0].name}`)
          assembly.sections.push({ name: 'round-table-mentions', text: composeSingleRoleSection(matched[0]) })
        } else if (matched.length >= 2) {
          log(`assemble multi roles=${matched.map((r) => r.name).join(',')}`)
          assembly.sections.push({ name: 'round-table-mentions', text: composeMultiWaitSection(matched) })
          assembly.tools = []
        }
      }
    } catch (error) {
      log(`assemble FAIL err=${String(error?.message ?? error)}`)
    }
    return next()
  }, 'round-table: mention role-card injection')

  // ---- 路由 ----
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
              rooms: state.rooms, // 兼容旧数据（v2 不再使用）
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
            const role = createRole({ id: typeof body.id === 'string' && body.id.length > 0 ? body.id : `role-${randomUUID()}`, ...body })
            mutate((s) => ({ ...s, roles: upsertRole(s.roles, role) }))
            json(res, 200, { role })
          },
        }),
        webServer.register({
          kind: 'exact', path: `${ROUTE_PREFIX}/roles/delete`,
          handler: async (req, res) => {
            if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed; use POST' }, { allow: 'POST' })
            if (isCrossOrigin(req.headers, req.headers.host)) return json(res, 403, { error: 'cross-origin request rejected' })
            const raw = await readBody(req)
            if (raw === null) return json(res, 413, { error: 'request body too large' })
            let body
            try { body = JSON.parse(raw || '{}') } catch { return json(res, 400, { error: 'invalid JSON body' }) }
            const id = body.id
            if (typeof id !== 'string' || id.length === 0 || !state.roles.some((r) => r.id === id)) {
              return json(res, 404, { error: 'role not found' })
            }
            mutate((s) => ({ ...s, roles: s.roles.filter((r) => r.id !== id) }))
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
  }, 'round-table: state/roles routes + events')
}
