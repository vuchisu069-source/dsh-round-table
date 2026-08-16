// round-table 浏览器 half：自渲染「圆桌」面板（FAB 开关 → 三栏：房间/角色库 · 时间线 · 成员与控制）。
// 官方 bundle client 形态：exports {name, apply} 经 __ModuleLoader__.load 注册，apply(ctx) 由 client 内核挂载。
// 零平台模块依赖：CSS 用 JS 内联（宿主可能覆盖注入样式，内联优先级最高——whale-girl 验证的环境事实）。
// 状态同步：/round-table/state 轮询 + /round-table/events SSE（双通道，SSE 断线轮询兜底）。

export const name = 'round-table'

const ROUTE_PREFIX = '/round-table'
const STATE_PATH = `${ROUTE_PREFIX}/state`
const EVENTS_PATH = `${ROUTE_PREFIX}/events`

const PALETTE = ['#8b9dc3', '#e8a838', '#5fbf7a', '#d97c7c', '#7c8fe8', '#c77ce8', '#e87cb0', '#6fc7c7']
let colorIdx = 0
const nextColor = () => PALETTE[colorIdx++ % PALETTE.length]

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]))

export function apply() {
  let state = null
  let currentRoomId = null
  let composeMode = 'manual'
  let composeText = ''
  let panelOpen = false

  // ---- 状态同步 ----
  const fetchState = async () => {
    try {
      const res = await fetch(STATE_PATH, { headers: { accept: 'application/json' } })
      if (!res.ok) return
      state = await res.json()
      if (!currentRoomId && state.rooms.length > 0) currentRoomId = state.rooms[0].id // 自动选中首个房间
      render()
    } catch { /* 服务器未就绪时静默 */ }
  }
  let pollTimer = null
  const startPoll = () => {
    clearInterval(pollTimer)
    pollTimer = setInterval(fetchState, 3000)
  }
  let sse = null
  const startSse = () => {
    try {
      sse = new EventSource(EVENTS_PATH)
      sse.onmessage = () => fetchState()
    } catch { /* EventSource 不可用时轮询兜底 */ }
  }

  // ---- DOM 骨架 ----
  // 入口：集成进宿主左侧边栏「工作区」标签右侧（React 重渲染会冲掉注入，MutationObserver 维持）。
  // 面板：居中浮层（不再有悬浮 FAB，避免遮挡宿主 UI）。

  const panel = document.createElement('div')
  panel.style.cssText = 'position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(900px, calc(100vw - 32px)); height:min(560px, calc(100vh - 120px)); background:#171a21; color:#e8ebf2; border:1px solid rgba(255,255,255,.1); border-radius:14px; display:none; flex-direction:row; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.5); z-index:2147483000; font-family:system-ui,sans-serif;'
  document.body.appendChild(panel)

  const sidebarButton = document.createElement('button')
  sidebarButton.textContent = '圆桌'
  sidebarButton.title = '圆桌（多方研讨）'
  sidebarButton.style.cssText = 'padding:1px 8px; border-radius:6px; border:none; cursor:pointer; font-size:11px; line-height:1.6; color:#e8ebf2; background:rgba(255,255,255,.14); margin-left:6px; flex-shrink:0;'
  sidebarButton.addEventListener('click', () => { panelOpen = !panelOpen; render() })

  // 按可见文本找「工作区/会话」标签的叶子元素（CSS-module 类名是哈希的，文本定位最稳）
  const SECTION_LABELS = ['工作区', '会话', 'Workspace', 'Sessions']
  const findSectionLabel = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (el) => {
        if (el.children.length > 0) return NodeFilter.FILTER_SKIP
        if (el.getAttribute && el.getAttribute('data-round-table') !== null) return NodeFilter.FILTER_REJECT
        const t = (el.textContent ?? '').trim()
        return SECTION_LABELS.includes(t) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      },
    })
    return walker.nextNode()
  }

  // 把按钮插到标签右侧（同一 sectionHeader 行内）；宽模式失败则尝试窄 rail；返回是否成功
  const injectSidebarButton = () => {
    if (sidebarButton.isConnected) return true
    // 宽侧边栏：插到「工作区/会话」标签右侧
    const label = findSectionLabel()
    if (label !== null && label.parentElement !== null) {
      label.parentElement.insertBefore(sidebarButton, label.nextSibling)
      return true
    }
    // 窄 rail 模式：标签不渲染（CSS-module 后缀名稳定：sidebarCol / collapsed）
    const railRoot = document.querySelector('[class*="sidebarCol"] [class*="collapsed"]')
    if (railRoot !== null) {
      railRoot.insertBefore(sidebarButton, railRoot.firstChild)
      return true
    }
    return false
  }

  // 宿主重渲染会移除注入的按钮：监听 body 变化，丢失即补插（微任务去抖）
  let injectQueued = false
  const scheduleInject = () => {
    if (injectQueued) return
    injectQueued = true
    queueMicrotask(() => {
      injectQueued = false
      injectSidebarButton()
    })
  }
  const domObserver = new MutationObserver(scheduleInject)
  domObserver.observe(document.body, { childList: true, subtree: true })
  scheduleInject()

  // 左栏：房间列表 + 角色库
  const left = document.createElement('div')
  left.style.cssText = 'width:220px; border-right:1px solid rgba(255,255,255,.08); padding:10px; overflow:auto; flex-shrink:0;'
  panel.appendChild(left)
  // 中栏：时间线 + 输入
  const middle = document.createElement('div')
  middle.style.cssText = 'flex:1; display:flex; flex-direction:column; min-width:0;'
  panel.appendChild(middle)
  const timeline = document.createElement('div')
  timeline.style.cssText = 'flex:1; overflow:auto; padding:12px;'
  middle.appendChild(timeline)
  const composer = document.createElement('div')
  composer.style.cssText = 'border-top:1px solid rgba(255,255,255,.08); padding:10px;'
  middle.appendChild(composer)
  // 右栏：成员 + 控制
  const right = document.createElement('div')
  right.style.cssText = 'width:230px; border-left:1px solid rgba(255,255,255,.08); padding:10px; overflow:auto; flex-shrink:0;'
  panel.appendChild(right)

  // ---- 事件 ----
  const post = async (path, body) => {
    try {
      await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
    } catch { /* 忽略 */ }
    fetchState()
  }

  const createRoleFlow = () => {
    const name = window.prompt('角色名称（如：架构师）')
    if (!name) return
    const systemPrompt = window.prompt('System Prompt（角色设定，可空）') ?? ''
    const personality = window.prompt('性格参数（可空）') ?? ''
    post(`${ROUTE_PREFIX}/roles`, { name, color: nextColor(), systemPrompt, personality })
  }

  const createRoomFlow = () => {
    const title = window.prompt('房间名称（如：支付网关需求评审）')
    if (!title) return
    const ids = state?.roles.map((r) => r.id) ?? []
    const chosen = ids.filter((id) => window.confirm(`把角色「${state.roles.find((r) => r.id === id).name}」拉入房间？`))
    post(`${ROUTE_PREFIX}/rooms`, { title, memberRoleIds: chosen })
  }

  const sendMessage = () => {
    const text = composeText.trim()
    if (!text || !currentRoomId) return
    const mentions = []
    const matchAll = [...text.matchAll(/@([\w\u4e00-\u9fa5-]+)/g)]
    const room = state?.rooms.find((r) => r.id === currentRoomId)
    for (const m of matchAll) {
      const member = room?.members.find((mm) => (state.roles.find((r) => r.id === mm.roleId)?.name ?? '') === m[1])
      if (member) mentions.push(member.id)
    }
    const mode = composeMode === 'manual' && mentions.length === 0 ? 'all' : composeMode
    post(`${ROUTE_PREFIX}/messages`, { roomId: currentRoomId, mode, text, mentions })
    composeText = ''
    render()
  }

  const control = (action, value) => {
    if (!currentRoomId) return
    post(`${ROUTE_PREFIX}/control`, { roomId: currentRoomId, action, value })
  }

  const addRoleFlow = () => {
    if (!currentRoomId) return
    const ids = (state?.roles ?? []).map((r) => r.id)
    const chosen = ids.filter((id) => window.confirm(`把角色「${state.roles.find((r) => r.id === id).name}」加入当前房间？`))
    for (const roleId of chosen) post(`${ROUTE_PREFIX}/members`, { roomId: currentRoomId, roleId })
  }

  const addSessionFlow = async () => {
    if (!currentRoomId) return
    let folders = []
    try {
      const res = await fetch(`${ROUTE_PREFIX}/sessions`, { headers: { accept: 'application/json' } })
      if (res.ok) folders = (await res.json()).folders ?? []
    } catch { /* 拉取失败 */ }
    const total = folders.reduce((n, f) => n + f.sessions.length, 0)
    if (total === 0) {
      window.alert('工作区暂无可用会话')
      return
    }
    // 排除已在房间的会话
    const room = state?.rooms.find((r) => r.id === currentRoomId)
    const taken = new Set((room?.members ?? []).filter((m) => m.sessionId).map((m) => m.sessionId))
    folders = folders
      .map((f) => ({ ...f, sessions: f.sessions.filter((s) => !taken.has(s.id)) }))
      .filter((f) => f.sessions.length > 0)

    // ---- 两栏模态：左选文件夹，右勾选对话框 ----
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:2147483001; display:flex; align-items:center; justify-content:center; font-family:system-ui,sans-serif;'
    const box = document.createElement('div')
    box.style.cssText = 'width:min(680px, calc(100vw - 40px)); max-height:72vh; background:#171a21; color:#e8ebf2; border-radius:14px; border:1px solid rgba(255,255,255,.12); padding:16px; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.5);'
    const head = document.createElement('div')
    head.textContent = '选择工作区文件夹 → 勾选该文件夹下的对话框'
    head.style.cssText = 'font-size:14px; font-weight:600; margin-bottom:10px;'
    box.appendChild(head)

    const body = document.createElement('div')
    body.style.cssText = 'display:flex; gap:10px; flex:1; min-height:0;'
    box.appendChild(body)
    // 左：文件夹列表
    const folderPane = document.createElement('div')
    folderPane.style.cssText = 'width:200px; flex-shrink:0; overflow:auto; border-right:1px solid rgba(255,255,255,.08); padding-right:8px;'
    body.appendChild(folderPane)
    // 右：会话勾选列表
    const sessionPane = document.createElement('div')
    sessionPane.style.cssText = 'flex:1; overflow:auto; min-width:0;'
    body.appendChild(sessionPane)

    let selectedFolder = folders[0]?.path ?? null
    const checks = [] // 当前选中文件夹的勾选状态 [{cb, id}]

    const renderFolders = () => {
      folderPane.innerHTML = ''
      for (const f of folders) {
        const row = document.createElement('div')
        const base = f.path.split('/').filter(Boolean).pop() || f.path
        row.textContent = `📁 ${base}（${f.sessions.length}）`
        row.title = f.path
        row.style.cssText = `padding:7px 8px; border-radius:8px; cursor:pointer; font-size:13px; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:${f.path === selectedFolder ? 'rgba(59,130,246,.25)' : 'transparent'};`
        row.addEventListener('click', () => { selectedFolder = f.path; renderFolders(); renderSessions(); })
        folderPane.appendChild(row)
      }
    }
    const renderSessions = () => {
      sessionPane.innerHTML = ''
      checks.length = 0
      const folder = folders.find((f) => f.path === selectedFolder)
      if (!folder) {
        sessionPane.textContent = '← 选择一个文件夹'
        sessionPane.style.cssText = 'flex:1; color:#8a93a6; font-size:12px; padding:8px;'
        updateOk()
        return
      }
      sessionPane.style.cssText = 'flex:1; overflow:auto; min-width:0;'
      const folderHead = document.createElement('div')
      folderHead.textContent = folder.path
      folderHead.style.cssText = 'font-size:11px; color:#8a93a6; margin-bottom:8px; word-break:break-all;'
      sessionPane.appendChild(folderHead)
      for (const s of folder.sessions) {
        const row = document.createElement('label')
        row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:7px 6px; border-radius:8px; cursor:pointer; font-size:13px;'
        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,.07)' })
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent' })
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.style.cssText = 'accent-color:#3b82f6; flex-shrink:0;'
        const txt = document.createElement('span')
        txt.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1;'
        txt.textContent = s.title
        txt.title = s.id
        row.appendChild(cb)
        row.appendChild(txt)
        sessionPane.appendChild(row)
        checks.push({ cb, id: s.id })
        cb.addEventListener('change', updateOk)
      }
      updateOk()
    }
    const bar = document.createElement('div')
    bar.style.cssText = 'display:flex; gap:8px; margin-top:12px; justify-content:flex-end; align-items:center;'
    const selHint = document.createElement('span')
    selHint.style.cssText = 'font-size:11px; color:#6b7280; margin-right:auto;'
    const mkBtn = (label, primary) => {
      const b = document.createElement('button')
      b.textContent = label
      b.style.cssText = `padding:6px 16px; border-radius:8px; border:none; cursor:pointer; font-size:13px; color:#e8ebf2; background:${primary ? '#3b82f6' : 'rgba(255,255,255,.12)'};`
      return b
    }
    const cancel = mkBtn('取消', false)
    cancel.addEventListener('click', () => overlay.remove())
    const ok = mkBtn('加入（0）', true)
    const updateOk = () => {
      const n = checks.filter((c) => c.cb.checked).length
      ok.textContent = `加入（${n}）`
      selHint.textContent = n > 0 ? `已选 ${n} 个对话框（来自 ${selectedFolder}）` : '在右侧勾选要拉入的对话框'
    }
    ok.addEventListener('click', () => {
      const chosen = checks.filter((c) => c.cb.checked).map((c) => c.id)
      overlay.remove()
      if (chosen.length === 0) return
      for (const id of chosen) post(`${ROUTE_PREFIX}/members`, { roomId: currentRoomId, sessionId: id })
    })
    bar.appendChild(selHint)
    bar.appendChild(cancel)
    bar.appendChild(ok)
    box.appendChild(bar)
    overlay.appendChild(box)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    renderFolders()
    renderSessions()
  }

  // D2：页面离开默认暂停（由 Node half 依配置决定是否生效）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && currentRoomId) {
      post(`${ROUTE_PREFIX}/presence`, { roomId: currentRoomId, visible: false })
    }
  })

  // ---- 渲染 ----
  const render = () => {
    panel.style.display = panelOpen ? 'flex' : 'none'
    if (!panelOpen || !state) return
    renderLeft()
    renderTimeline()
    renderRight()
    renderComposer()
  }

  const renderLeft = () => {
    left.innerHTML = ''
    const title = document.createElement('div')
    title.textContent = '房间 / 角色'
    title.style.cssText = 'font-size:12px; color:#8a93a6; margin-bottom:8px;'
    left.appendChild(title)
    for (const room of state.rooms) {
      const row = document.createElement('div')
      row.textContent = `${room.paused ? '⏸ ' : ''}${esc(room.title)}（${room.round}/${room.maxRounds}轮）`
      row.style.cssText = `padding:7px 8px; border-radius:8px; cursor:pointer; font-size:13px; margin-bottom:4px; background:${room.id === currentRoomId ? 'rgba(255,255,255,.12)' : 'transparent'};`
      row.addEventListener('click', () => { currentRoomId = room.id; render() })
      left.appendChild(row)
    }
    const newRoom = button('+ 新建房间', () => createRoomFlow())
    left.appendChild(newRoom)
    const hr = document.createElement('div')
    hr.style.cssText = 'height:1px; background:rgba(255,255,255,.08); margin:10px 0;'
    left.appendChild(hr)
    for (const role of state.roles) {
      const row = document.createElement('div')
      row.style.cssText = 'padding:5px 8px; font-size:12px; color:#aeb6c4;'
      row.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${esc(role.color)};margin-right:6px;"></span>${esc(role.name)}`
      left.appendChild(row)
    }
    left.appendChild(button('+ 新建角色', () => createRoleFlow()))
  }

  const renderTimeline = () => {
    timeline.innerHTML = ''
    const room = state.rooms.find((r) => r.id === currentRoomId)
    if (!room) {
      timeline.textContent = '← 选择一个房间，或新建房间'
      timeline.style.cssText = 'flex:1; padding:24px; color:#8a93a6; font-size:13px;'
      return
    }
    timeline.style.cssText = 'flex:1; overflow:auto; padding:12px;'
    const head = document.createElement('div')
    head.style.cssText = 'font-size:15px; font-weight:600; margin-bottom:10px;'
    head.textContent = `${esc(room.title)}　·　${room.mode} 模式　·　第 ${room.round}/${room.maxRounds} 轮${room.paused ? '　⏸ 已暂停' : ''}${room.running ? '　⏳ 研讨中' : ''}`
    timeline.appendChild(head)
    for (const msg of room.messages) {
      const row = document.createElement('div')
      row.style.cssText = 'margin-bottom:8px; font-size:13px; line-height:1.55;'
      if (msg.kind === 'user') {
        row.style.cssText += 'text-align:right;'
        row.innerHTML = `<span style="display:inline-block;max-width:78%;background:#2f3542;border-radius:10px;padding:7px 10px;text-align:left;white-space:pre-wrap;">${esc(msg.text)}</span>`
      } else if (msg.kind === 'agent') {
        row.innerHTML = `<div style="display:inline-block;max-width:82%;background:rgba(255,255,255,.06);border-radius:10px;padding:7px 10px;white-space:pre-wrap;"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${esc(msg.color)};margin-right:6px;"></span><b style="color:${esc(msg.color)};">${esc(msg.authorName)}</b><span style="color:#6b7280;margin-left:6px;font-size:11px;">第${msg.round ?? '?'}轮</span><br>${esc(msg.text)}</div>`
      } else {
        row.style.cssText = 'text-align:center; color:#6b7280; font-size:12px;'
        row.textContent = msg.text
      }
      timeline.appendChild(row)
    }
    timeline.scrollTop = timeline.scrollHeight
  }

  const renderRight = () => {
    right.innerHTML = ''
    const room = state.rooms.find((r) => r.id === currentRoomId)
    if (!room) {
      // 空态引导：没有房间时右栏不空白
      const hint = document.createElement('div')
      hint.textContent = state.rooms.length === 0 ? '还没有房间：\n在左栏「+ 新建房间」创建一个，\n或先「+ 新建角色」。' : '← 在左栏选择一个房间'
      hint.style.cssText = 'font-size:12px; color:#8a93a6; white-space:pre-line; line-height:1.7; padding:8px;'
      right.appendChild(hint)
      return
    }
    const title = document.createElement('div')
    title.textContent = '成员 / 控制'
    title.style.cssText = 'font-size:12px; color:#8a93a6; margin-bottom:8px;'
    right.appendChild(title)
    for (const member of room.members) {
      const isSession = member.kind === 'session'
      const name = isSession ? member.title ?? member.sessionId : state.roles.find((r) => r.id === member.roleId)?.name ?? member.id
      const color = isSession ? '#7c8fe8' : (state.roles.find((r) => r.id === member.roleId)?.color ?? '#8b9dc3')
      const dot = member.status === 'thinking' ? '🟡' : member.status === 'error' ? '🔴' : '🟢'
      const icon = isSession ? '💬' : '🎭'
      const row = document.createElement('div')
      row.textContent = `${icon} ${dot} ${name}${member.status === 'thinking' ? '（思考中）' : ''}`
      row.style.cssText = `padding:5px 8px; font-size:12px; color:${color};`
      right.appendChild(row)
    }
    right.appendChild(button('+ 加入角色（自建）', () => addRoleFlow()))
    right.appendChild(button('+ 加入工作区对话框', () => addSessionFlow()))
    const hr = document.createElement('div')
    hr.style.cssText = 'height:1px; background:rgba(255,255,255,.08); margin:10px 0;'
    right.appendChild(hr)
    right.appendChild(button(room.paused ? '▶ 继续' : '⏸ 暂停', () => control(room.paused ? 'resume' : 'pause')))
    right.appendChild(button('📝 一键总结', () => control('summarize')))
    const rounds = document.createElement('input')
    rounds.type = 'number'
    rounds.min = 1
    rounds.max = 20
    rounds.value = room.maxRounds
    rounds.style.cssText = 'width:100%; box-sizing:border-box; margin-top:8px; padding:6px 8px; border-radius:8px; border:1px solid rgba(255,255,255,.15); background:#22262e; color:#e8ebf2; font-size:13px;'
    rounds.addEventListener('change', () => control('setRounds', Number(rounds.value)))
    right.appendChild(rounds)
    const roundsLabel = document.createElement('div')
    roundsLabel.textContent = '最大轮数（防死循环上限）'
    roundsLabel.style.cssText = 'font-size:11px; color:#6b7280; margin-top:4px;'
    right.appendChild(roundsLabel)
    if (room.summaries.length > 0) {
      const hr2 = document.createElement('div')
      hr2.style.cssText = 'height:1px; background:rgba(255,255,255,.08); margin:10px 0;'
      right.appendChild(hr2)
      for (const s of room.summaries) {
        const card = document.createElement('div')
        card.textContent = s.text
        card.style.cssText = 'font-size:11px; color:#c9d1de; background:rgba(255,255,255,.05); border-radius:8px; padding:6px 8px; margin-bottom:6px; white-space:pre-wrap; max-height:200px; overflow:auto;'
        right.appendChild(card)
      }
    }
  }

  const button = (label, onClick) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'display:block; width:100%; margin-top:6px; padding:6px 8px; border-radius:8px; border:none; cursor:pointer; font-size:12px; color:#e8ebf2; background:rgba(255,255,255,.1); text-align:left;'
    b.addEventListener('click', onClick)
    return b
  }

  // 输入区（composer）：模式切换 + 文本
  const modeBar = document.createElement('div')
  modeBar.style.cssText = 'display:flex; gap:6px; margin-bottom:6px;'
  composer.appendChild(modeBar)
  const textarea = document.createElement('textarea')
  textarea.placeholder = '输入议题…（@角色名 可指定发言；空 @ 时默认全体研讨）'
  textarea.style.cssText = 'width:100%; box-sizing:border-box; min-height:52px; resize:vertical; border-radius:8px; border:1px solid rgba(255,255,255,.15); background:#22262e; color:#e8ebf2; padding:8px; font-size:13px; font-family:inherit;'
  textarea.addEventListener('input', () => { composeText = textarea.value })
  composer.appendChild(textarea)
  const sendBar = document.createElement('div')
  sendBar.style.cssText = 'display:flex; gap:6px; margin-top:6px; align-items:center;'
  composer.appendChild(sendBar)
  for (const [value, label] of [['manual', '@ 指定'], ['all', '全体研讨'], ['chain', '接力链']]) {
    const chip = document.createElement('button')
    chip.textContent = label
    chip.style.cssText = `padding:4px 10px; border-radius:14px; border:none; cursor:pointer; font-size:12px; color:#e8ebf2; background:${composeMode === value ? '#3b82f6' : 'rgba(255,255,255,.1)'};`
    chip.addEventListener('click', () => { composeMode = value; render() })
    modeBar.appendChild(chip)
  }
  const sendBtn = document.createElement('button')
  sendBtn.textContent = '发送'
  sendBtn.style.cssText = 'padding:6px 16px; border-radius:8px; border:none; cursor:pointer; font-size:13px; color:#fff; background:#3b82f6;'
  sendBtn.addEventListener('click', sendMessage)
  sendBar.appendChild(sendBtn)
  const modeNote = document.createElement('span')
  modeNote.style.cssText = 'font-size:11px; color:#6b7280;'
  sendBar.appendChild(modeNote)
  const renderComposer = () => {
    modeNote.textContent = composeMode === 'manual'
      ? '文本中 @ 角色名即点名发言'
      : composeMode === 'all'
        ? '所有成员按序各发言一次（1 轮）'
        : '链式：A 输出作为 B 的上下文（轮次上限控制）'
    const active = composeMode === 'manual' ? '@ 指定' : composeMode === 'all' ? '全体研讨' : '接力链'
    for (const chip of modeBar.children) {
      chip.style.background = chip.textContent === active ? '#3b82f6' : 'rgba(255,255,255,.1)'
    }
  }

  document.body.appendChild(root)
  void fetchState()
  startPoll()
  startSse()

  return () => {
    clearInterval(pollTimer)
    if (sse) sse.close()
    domObserver.disconnect()
    sidebarButton.remove()
    panel.remove()
  }
}
