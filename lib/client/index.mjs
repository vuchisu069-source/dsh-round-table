// round-table 浏览器 half：@ 提及范式（v2 大改）
// - 左栏：向宿主左栏注入「圆桌成员」section（角色卡片：avatar+名称，编辑/新建）
// - @ 提及：注册到 ctx.inputTriggers（官方 @ 管线）——输入 @ 时弹出角色候选，选中插入 `@角色名`
// - 无房间/右栏/中心区：讨论直接发生在 DSH 主对话（Node 侧注入角色卡）
// 零平台模块依赖：CSS 用 JS 内联。状态同步：/round-table/state 轮询 + SSE。

export const name = 'round-table'

const ROUTE_PREFIX = '/round-table'
const STATE_PATH = `${ROUTE_PREFIX}/state`
const EVENTS_PATH = `${ROUTE_PREFIX}/events`

// ---- 形象系统（D6：4 形状 × 10 表情 × 8 色调） ----
const SHAPES = ['circle', 'square', 'hexagon', 'triangle']
const SHAPE_PATHS = {
  circle: 'M50,2 A48,48 0 1,1 49.99,2 Z',
  square: 'M8,10 Q8,2 16,2 L84,2 Q92,2 92,10 L92,82 Q92,90 84,90 L16,90 Q8,90 8,82 Z',
  hexagon: 'M50,2 L93,27 L93,73 L50,98 L7,73 L7,27 Z',
  triangle: 'M50,4 L95,92 L5,92 Z',
}
const SHAPE_EMOJI_Y = { circle: 70, square: 68, hexagon: 68, triangle: 82 }
const SHAPE_EMOJI_SIZE = { circle: 44, square: 42, hexagon: 44, triangle: 36 }
const EMOJIS = ['🙂', '😎', '🤓', '😴', '😡', '😺', '👻', '🦊', '🐱', '🤖']
const PALETTE = ['#8b9dc3', '#e8a838', '#5fbf7a', '#d97c7c', '#7c8fe8', '#c77ce8', '#e87cb0', '#6fc7c7']

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]))

let colorIdx = 0
const nextColor = () => PALETTE[colorIdx++ % PALETTE.length]
const defaultAvatar = () => ({ shape: 'circle', emoji: '🙂', color: PALETTE[0] })

/** 内联 SVG 形象：填充色形状 + 居中表情。 */
const renderAvatar = (avatar, size = 32) => {
  const a = (avatar !== null && typeof avatar === 'object') ? avatar : defaultAvatar()
  const path = SHAPE_PATHS[a.shape] || SHAPE_PATHS.circle
  const y = SHAPE_EMOJI_Y[a.shape] || 70
  const fs = SHAPE_EMOJI_SIZE[a.shape] || 44
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="display:inline-block;vertical-align:middle;flex-shrink:0;" aria-label="${esc(a.emoji)}">`
    + `<path d="${path}" fill="${esc(a.color)}"/>`
    + `<text x="50" y="${y}" text-anchor="middle" font-size="${fs}" style="font-family:system-ui,Apple Color Emoji,Segoe UI Emoji,sans-serif;paint-order:stroke;stroke:rgba(0,0,0,.15);stroke-width:0.5;">${esc(a.emoji)}</text>`
    + `</svg>`
}

/** @ source 候选的 icon：官方菜单把 icon 当纯文本渲染（React children），用 emoji 最稳。 */
const avatarIcon = (avatar) => {
  const a = (avatar !== null && typeof avatar === 'object') ? avatar : defaultAvatar()
  return typeof a.emoji === 'string' && a.emoji.length > 0 ? a.emoji : '🎭'
}

export function apply(ctx) {
  let state = null

  // ---- 状态同步 ----
  const fetchState = async () => {
    try {
      const res = await fetch(STATE_PATH, { headers: { accept: 'application/json' } })
      if (!res.ok) return
      state = await res.json()
      render()
    } catch { /* 服务器未就绪时静默 */ }
  }
  let pollTimer = null
  const startPoll = () => { clearInterval(pollTimer); pollTimer = setInterval(fetchState, 3000) }
  let sse = null
  const startSse = () => {
    try {
      sse = new EventSource(EVENTS_PATH)
      sse.onmessage = () => { void refreshRolesCache(); fetchState() }
    } catch { /* EventSource 不可用时轮询兜底 */ }
  }

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

  // ---- DOM 工厂 ----
  const mk = (tag, style, ...children) => {
    const n = document.createElement(tag)
    if (style) n.style.cssText = style
    for (const c of children) {
      if (c === null || c === undefined) continue
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    }
    return n
  }
  const mkBtn = (label, onClick, primary = false) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `padding:6px 12px; border-radius:8px; border:none; cursor:pointer; font-size:12px; color:${primary ? '#fff' : '#e8ebf2'}; background:${primary ? '#3b82f6' : 'rgba(255,255,255,.1)'};`
    b.addEventListener('click', onClick)
    return b
  }

  // ---- 元素定位 ----
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

  /** 从标签向上找最可能是 DSH 左栏的祖先（左偏移近 0、高度 > 半屏）。 */
  const findLeftSidebarContainer = (label) => {
    let node = label
    let best = null
    while (node !== null && node !== document.body) {
      const rect = node.getBoundingClientRect()
      if (rect.left < 20 && rect.height > window.innerHeight * 0.5 && rect.width < window.innerWidth * 0.4) {
        best = node
      }
      node = node.parentElement
    }
    return best
  }

  // ---- 左栏 section（注入宿主左栏底部） ----
  // 关键：不能 append 到 sidebarCol 直接子级——布局只渲染第一个子级（root），
  // 追加的子级会落在可视区外被 overflow:hidden 裁剪（实测 top:664 > 容器 658）。
  // 必须注入到 regionArea 的内容根（flex-column）内部末尾，紧跟会话列表。
  const leftSection = mk('div', 'flex-shrink:0; max-height:200px; overflow-y:auto; padding:10px; border-top:1px solid rgba(255,255,255,.08); margin-top:6px;')
  leftSection.dataset.roundTable = 'left'

  const leftHeader = mk('div', 'display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;')
  const leftTitle = mk('div', 'font-size:11px; color:#8a93a6; text-transform:uppercase; letter-spacing:.5px;', '圆桌成员')
  leftHeader.appendChild(leftTitle)
  const leftHint = mk('div', 'font-size:10px; color:#6b7280;', '在输入框 @ 角色名 即可对话')
  leftHeader.appendChild(leftHint)
  leftSection.appendChild(leftHeader)

  const leftList = mk('div', 'display:flex; flex-direction:column; gap:4px;')
  leftSection.appendChild(leftList)

  const leftActions = mk('div', 'display:flex; flex-direction:column; gap:6px; margin-top:10px;')
  leftActions.appendChild(mkBtn('+ 新建角色', () => openNewAgentModal()))
  leftSection.appendChild(leftActions)

  const injectLeft = () => {
    if (leftSection.isConnected) return
    // 策略 0：精确锚定 regionArea 内容根（qDHVXG_root，flex-column）——实测有效
    const regionRoot = document.querySelector('[class*="regionArea"] [class*="root"]')
    if (regionRoot !== null) {
      try { regionRoot.appendChild(leftSection); return } catch { /* fallthrough */ }
    }
    // 策略 1：regionArea 本身
    const regionArea = document.querySelector('[class*="regionArea"]')
    if (regionArea !== null) {
      try { regionArea.appendChild(leftSection); return } catch { /* fallthrough */ }
    }
    // 策略 2：从「工作区」标签向上找左栏容器（启发式）
    const label = findSectionLabel()
    const container = label !== null ? findLeftSidebarContainer(label) : null
    if (container !== null) {
      try { container.appendChild(leftSection); return } catch { /* fallthrough */ }
    }
    // 策略 3：窄 rail 模式
    const railRoot = document.querySelector('[class*="sidebarCol"] [class*="collapsed"]')
    if (railRoot !== null) {
      try { railRoot.appendChild(leftSection); return } catch { /* fallthrough */ }
    }
    // 注入失败：静默不显示（创建角色也可经 @ 空态提示引导）
  }
  let injectQueued = false
  const scheduleInjectLeft = () => {
    if (injectQueued) return
    injectQueued = true
    queueMicrotask(() => { injectQueued = false; injectLeft() })
  }

  // ---- New Agent 模态 ----
  const openNewAgentModal = (existing) => {
    const isEdit = existing !== undefined
    const initial = isEdit
      ? { ...existing, avatar: { ...(existing.avatar ?? defaultAvatar()) }, soul: existing.soul ?? '' }
      : { name: '', title: '', description: '', systemPrompt: '', personality: '', soul: '', avatar: { shape: 'circle', emoji: '🙂', color: nextColor() } }
    let draft = JSON.parse(JSON.stringify(initial))

    const overlay = mk('div', 'position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:2147483002; display:flex; align-items:center; justify-content:center; font-family:system-ui,sans-serif;')
    const box = mk('div', 'width:min(520px, calc(100vw - 40px)); max-height:84vh; background:#171a21; color:#e8ebf2; border-radius:14px; border:1px solid rgba(255,255,255,.12); padding:18px; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.5); overflow:auto;')
    overlay.appendChild(box)

    const title = mk('div', 'font-size:16px; font-weight:600; margin-bottom:4px;', isEdit ? '编辑角色' : 'New Agent')
    const subtitle = mk('div', 'font-size:12px; color:#8a93a6; margin-bottom:14px;', '创建后在输入框输入 @ 即可召唤该角色对话/参与讨论。')
    box.appendChild(title)
    box.appendChild(subtitle)

    // 大形象预览
    const previewBox = mk('div', 'display:flex; align-items:center; justify-content:center; padding:12px 0; margin-bottom:8px;')
    const previewSvg = mk('div')
    previewBox.appendChild(previewSvg)
    box.appendChild(previewBox)

    // 形状
    const shapeRow = mk('div', 'display:flex; gap:8px;')
    box.appendChild(mk('div', 'font-size:11px; color:#8a93a6; margin:8px 0 6px;', '形状'))
    for (const s of SHAPES) {
      const btn = mk('button', `padding:6px; border-radius:8px; border:1px solid ${draft.avatar.shape === s ? '#3b82f6' : 'rgba(255,255,255,.15)'}; background:${draft.avatar.shape === s ? 'rgba(59,130,246,.2)' : 'transparent'}; cursor:pointer;`)
      btn.innerHTML = renderAvatar({ ...draft.avatar, shape: s }, 36)
      btn.addEventListener('click', () => { draft.avatar.shape = s; render() })
      shapeRow.appendChild(btn)
    }
    box.appendChild(shapeRow)

    // 表情
    const emojiRow = mk('div', 'display:flex; flex-wrap:wrap; gap:6px;')
    box.appendChild(mk('div', 'font-size:11px; color:#8a93a6; margin:12px 0 6px;', '表情'))
    for (const e of EMOJIS) {
      const btn = mk('button', `width:38px; height:38px; border-radius:8px; border:1px solid ${draft.avatar.emoji === e ? '#3b82f6' : 'rgba(255,255,255,.15)'}; background:${draft.avatar.emoji === e ? 'rgba(59,130,246,.2)' : 'transparent'}; cursor:pointer; font-size:20px; padding:0;`)
      btn.textContent = e
      btn.addEventListener('click', () => { draft.avatar.emoji = e; render() })
      emojiRow.appendChild(btn)
    }
    box.appendChild(emojiRow)

    // 颜色
    const colorRow = mk('div', 'display:flex; flex-wrap:wrap; gap:8px;')
    box.appendChild(mk('div', 'font-size:11px; color:#8a93a6; margin:12px 0 6px;', '颜色'))
    for (const c of PALETTE) {
      const btn = mk('button', `width:28px; height:28px; border-radius:50%; border:2px solid ${draft.avatar.color === c ? '#fff' : 'transparent'}; background:${c}; cursor:pointer;`)
      btn.addEventListener('click', () => { draft.avatar.color = c; render() })
      colorRow.appendChild(btn)
    }
    box.appendChild(colorRow)

    // 字段
    const mkField = (labelText, key, placeholder, isTextarea = false) => {
      const wrap = mk('div', 'margin-top:12px;')
      wrap.appendChild(mk('div', 'font-size:11px; color:#8a93a6; margin-bottom:4px;', labelText))
      const input = isTextarea ? mk('textarea') : mk('input')
      input.placeholder = placeholder
      input.value = draft[key] ?? ''
      input.style.cssText = 'width:100%; box-sizing:border-box; padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,.15); background:#22262e; color:#e8ebf2; font-size:13px; font-family:inherit;'
      if (isTextarea) input.style.minHeight = '52px'
      input.addEventListener('input', () => { draft[key] = input.value })
      wrap.appendChild(input)
      return wrap
    }
    box.appendChild(mkField('名称（必填，@ 时输入此名）', 'name', '如：架构师'))
    box.appendChild(mkField('Title（可选）', 'title', '如：Inbox Triage'))
    box.appendChild(mkField('描述（可选）', 'description', '这个角色帮什么？', true))
    box.appendChild(mkField('System Prompt（角色设定）', 'systemPrompt', '性格、立场、专长…', true))
    box.appendChild(mkField('性格参数（可选）', 'personality', '风险偏好、表达风格…', true))

    // ---- Advanced 折叠区（Hermes 范式） ----
    const advToggle = mk('button', 'margin-top:14px; width:100%; display:flex; align-items:center; justify-content:space-between; padding:9px 12px; border-radius:8px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.05); color:#c9d1de; cursor:pointer; font-size:13px;', '')
    const advToggleLabel = mk('span', '', 'Advanced')
    const advToggleArrow = mk('span', 'font-size:11px; color:#6b7280;', '⌄ 展开')
    advToggle.appendChild(advToggleLabel)
    advToggle.appendChild(advToggleArrow)
    box.appendChild(advToggle)

    const advBody = mk('div', 'display:none; margin-top:10px;')
    box.appendChild(advBody)

    // SOUL.md
    advBody.appendChild(mk('div', 'font-size:11px; color:#8a93a6; margin:10px 0 4px;', 'SOUL.md — 角色人设文档（@ 时注入，留空则自动从名称/描述合成，上限 2000 字）'))
    const soulInput = mk('textarea')
    soulInput.placeholder = '# 角色灵魂\n这里写这个角色的完整人设、背景故事、立场、禁忌…'
    soulInput.value = draft.soul
    soulInput.style.cssText = 'width:100%; box-sizing:border-box; min-height:88px; resize:vertical; border-radius:8px; border:1px solid rgba(255,255,255,.15); background:#22262e; color:#e8ebf2; font-size:12px; font-family:inherit; padding:8px 10px;'
    soulInput.addEventListener('input', () => { draft.soul = soulInput.value })
    advBody.appendChild(soulInput)

    // 占位（暂未开放）：工具能力由 DSH 宿主自带，无需插件配置
    const disabledHint = mk('div', 'margin-top:12px; padding:8px 10px; border-radius:8px; background:rgba(255,255,255,.04); color:#6b7280; font-size:11px; line-height:1.6;', '工具/读代码等能力由 DSH 宿主原生提供（无需在此配置）。Provider / Model · 独立 API Key · Share keys & accounts —— 暂未开放（后续版本支持角色独立模型/凭据）')
    advBody.appendChild(disabledHint)

    advToggle.addEventListener('click', () => {
      const open = advBody.style.display === 'block'
      advBody.style.display = open ? 'none' : 'block'
      advToggleArrow.textContent = open ? '⌄ 展开' : '⌃ 收起'
    })

    const bar = mk('div', 'display:flex; gap:8px; margin-top:16px; justify-content:flex-end;')
    if (isEdit) {
      const delBtn = mkBtn('删除', () => {
        if (window.confirm(`删除角色「${draft.name}」？此操作不可恢复。`)) {
          post(`${ROUTE_PREFIX}/roles/delete`, { id: existing.id })
          overlay.remove()
        }
      }, false)
      delBtn.style.color = '#f87171'
      delBtn.style.border = '1px solid rgba(248,113,113,.4)'
      delBtn.style.background = 'rgba(248,113,113,.12)'
      delBtn.style.marginRight = 'auto'
      bar.appendChild(delBtn)
    }
    const cancel = mkBtn('取消', () => overlay.remove(), false)
    const submit = mkBtn(isEdit ? '保存' : '创建', () => {
      const name = draft.name.trim()
      if (name.length === 0) { window.alert('名称必填'); return }
      const id = isEdit ? existing.id : `role-${(crypto.randomUUID?.() ?? Math.random().toString(36).slice(2))}`
      post(`${ROUTE_PREFIX}/roles`, { ...draft, id })
      overlay.remove()
    }, true)
    bar.appendChild(cancel)
    bar.appendChild(submit)
    box.appendChild(bar)

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
    render()

    function render() {
      previewSvg.innerHTML = renderAvatar(draft.avatar, 96)
      const shapes = shapeRow.children
      for (let i = 0; i < shapes.length; i++) {
        const active = draft.avatar.shape === SHAPES[i]
        shapes[i].style.borderColor = active ? '#3b82f6' : 'rgba(255,255,255,.15)'
        shapes[i].style.background = active ? 'rgba(59,130,246,.2)' : 'transparent'
        shapes[i].innerHTML = renderAvatar({ ...draft.avatar, shape: SHAPES[i] }, 36)
      }
      const emojis = emojiRow.children
      for (let i = 0; i < emojis.length; i++) {
        const active = draft.avatar.emoji === EMOJIS[i]
        emojis[i].style.borderColor = active ? '#3b82f6' : 'rgba(255,255,255,.15)'
        emojis[i].style.background = active ? 'rgba(59,130,246,.2)' : 'transparent'
      }
      const colors = colorRow.children
      for (let i = 0; i < colors.length; i++) {
        const active = draft.avatar.color === PALETTE[i]
        colors[i].style.borderColor = active ? '#fff' : 'transparent'
      }
    }
  }

  // ---- 左栏：角色卡片 ----
  const render = () => {
    leftList.innerHTML = ''
    const roles = state?.roles ?? []
    for (const role of roles) {
      const card = mk('div', 'display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; cursor:pointer; font-size:13px; background:transparent; transition:background .15s;')
      card.dataset.rtKey = `role:${role.id}`
      const avatarWrap = mk('span')
      avatarWrap.innerHTML = renderAvatar(role.avatar, 28)
      const nameWrap = mk('div', 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;')
      const nameLine = mk('div', 'color:#e8ebf2; font-size:13px;', role.name)
      // SOUL badge（Advanced）
      if (typeof role.soul === 'string' && role.soul.length > 0) {
        nameLine.appendChild(mk('span', 'color:#c77ce8; font-size:10px; margin-left:6px;', '📄'))
      }
      const subLine = mk('div', 'color:#6b7280; font-size:10px;', role.title || (role.systemPrompt ? role.systemPrompt.slice(0, 24) : '未设置人设'))
      nameWrap.appendChild(nameLine)
      nameWrap.appendChild(subLine)
      // 点击卡片 → 自动在输入框插入 @角色名（便捷召唤）
      card.addEventListener('click', () => insertMentionIntoInput(role.name))
      const editBtn = mk('button', 'background:transparent; border:none; color:#6b7280; cursor:pointer; font-size:14px; padding:0 4px;', '⋯')
      editBtn.title = '编辑'
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openNewAgentModal(role) })
      card.appendChild(avatarWrap)
      card.appendChild(nameWrap)
      card.appendChild(editBtn)
      card.addEventListener('mouseenter', () => { card.style.background = 'rgba(255,255,255,.06)' })
      card.addEventListener('mouseleave', () => { card.style.background = 'transparent' })
      leftList.appendChild(card)
    }
    if (roles.length === 0) {
      const empty = mk('div', 'font-size:11px; color:#6b7280; padding:8px; text-align:center; line-height:1.6;', '还没有角色\n点「+ 新建角色」创建')
      empty.style.whiteSpace = 'pre-line'
      leftList.appendChild(empty)
    }
  }

  // ---- 点击角色卡 → 把 @角色名 插入宿主输入框（聚焦 + 末尾追加） ----
  const insertMentionIntoInput = (roleName) => {
    const targets = ['textarea', 'input', '[contenteditable="true"]', '[contenteditable=""]']
    let box = null
    for (const sel of targets) {
      const els = document.querySelectorAll(sel)
      for (const el of els) {
        if (!el.isConnected) continue
        if (el.closest('[data-round-table]')) continue
        const rect = el.getBoundingClientRect()
        // 主输入框特征：宽 > 50% 视口、位于视口下半部
        if (rect.width > window.innerWidth * 0.4 && rect.bottom > window.innerHeight * 0.4) { box = el; break }
      }
      if (box) break
    }
    if (!box) { window.alert('未找到输入框，请手动输入 @' + roleName); return }
    box.focus()
    if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
      const text = box.value ?? ''
      const sep = text.length > 0 && !text.endsWith(' ') ? ' ' : ''
      box.value = text + sep + `@${roleName} `
      box.dispatchEvent(new Event('input', { bubbles: true }))
      box.setSelectionRange(box.value.length, box.value.length)
    } else {
      // contenteditable
      const sel = window.getSelection()
      const node = document.createTextNode(`@${roleName} `)
      sel?.getRangeAt(0)?.insertNode(node)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  // ---- @ source 注册到官方输入触发管线 ----
  let rolesCache = []
  const refreshRolesCache = async () => {
    try {
      const res = await fetch(STATE_PATH, { headers: { accept: 'application/json' } })
      if (!res.ok) return
      rolesCache = (await res.json()).roles ?? []
    } catch { /* 忽略 */ }
  }
  const registerMentionSource = () => {
    const inputTriggers = (typeof ctx?.get === 'function' ? ctx.get('inputTriggers') : undefined)
      ?? (ctx !== undefined ? ctx.inputTriggers : undefined)
    if (inputTriggers === undefined || typeof inputTriggers.registerSource !== 'function') {
      // 管线不可用：降级为说明（不阻断其他功能）
      return undefined
    }
    try {
      return inputTriggers.registerSource({
        trigger: '@',
        name: '圆桌角色',
        order: -20,
        candidates: async (session, req) => {
          // 每次 @ 触发都实时刷新缓存（角色可能刚创建/编辑/删除）
          await refreshRolesCache()
          const q = (req?.query ?? '').trim()
          return rolesCache
            .filter((r) => r !== null && typeof r === 'object' && typeof r.name === 'string')
            .filter((r) => q.length === 0 || r.name.toLowerCase().includes(q.toLowerCase()))
            .map((r) => ({
              name: r.name,
              description: r.title || (typeof r.systemPrompt === 'string' ? r.systemPrompt.slice(0, 32) : undefined),
              icon: avatarIcon(r.avatar),
              hint: '圆桌角色',
            }))
        },
        onPick: (pick) => {
          const name = pick?.candidate?.name
          if (typeof name !== 'string' || name.length === 0) return undefined
          // 与官方 @ source 一致：插入字面 @角色名 （Node 侧解析并注入角色卡）
          return { text: `@${name} ` }
        },
        warm: () => { void refreshRolesCache() },
      })
    } catch (e) {
      try { console.error('[round-table] mention source register failed:', e) } catch { /* */ }
      return undefined
    }
  }

  // ---- 启动 ----
  const domObserver = new MutationObserver(scheduleInjectLeft)
  domObserver.observe(document.body, { childList: true, subtree: true })
  scheduleInjectLeft()

  // 注册 @ source（若管线在 ctx 中可用）；effect 包裹以便卸载
  const disposeSource = (() => {
    const d = registerMentionSource()
    return typeof d === 'function' ? d : () => {}
  })()

  void fetchState()
  startPoll()
  startSse()

  return () => {
    clearInterval(pollTimer)
    if (sse) sse.close()
    domObserver.disconnect()
    disposeSource()
    leftSection.remove()
  }
}
