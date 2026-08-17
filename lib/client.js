window.__ModuleLoader__.load({
	id: "round-table",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/client/index.mjs
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var name = "round-table";
var ROUTE_PREFIX = "/round-table";
var STATE_PATH = `${ROUTE_PREFIX}/state`;
var EVENTS_PATH = `${ROUTE_PREFIX}/events`;
var SHAPES = ["circle", "square", "hexagon", "triangle"];
var SHAPE_PATHS = {
  circle: "M50,2 A48,48 0 1,1 49.99,2 Z",
  square: "M8,10 Q8,2 16,2 L84,2 Q92,2 92,10 L92,82 Q92,90 84,90 L16,90 Q8,90 8,82 Z",
  hexagon: "M50,2 L93,27 L93,73 L50,98 L7,73 L7,27 Z",
  triangle: "M50,4 L95,92 L5,92 Z"
};
var SHAPE_EMOJI_Y = { circle: 70, square: 68, hexagon: 68, triangle: 82 };
var SHAPE_EMOJI_SIZE = { circle: 44, square: 42, hexagon: 44, triangle: 36 };
var EMOJIS = ["\u{1F642}", "\u{1F60E}", "\u{1F913}", "\u{1F634}", "\u{1F621}", "\u{1F63A}", "\u{1F47B}", "\u{1F98A}", "\u{1F431}", "\u{1F916}"];
var PALETTE = ["#8b9dc3", "#e8a838", "#5fbf7a", "#d97c7c", "#7c8fe8", "#c77ce8", "#e87cb0", "#6fc7c7"];
var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[c]);
var colorIdx = 0;
var nextColor = () => PALETTE[colorIdx++ % PALETTE.length];
var defaultAvatar = () => ({ shape: "circle", emoji: "\u{1F642}", color: PALETTE[0] });
var renderAvatar = (avatar, size = 32) => {
  const a = avatar !== null && typeof avatar === "object" ? avatar : defaultAvatar();
  const path = SHAPE_PATHS[a.shape] || SHAPE_PATHS.circle;
  const y = SHAPE_EMOJI_Y[a.shape] || 70;
  const fs = SHAPE_EMOJI_SIZE[a.shape] || 44;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="display:inline-block;vertical-align:middle;flex-shrink:0;" aria-label="${esc(a.emoji)}"><path d="${path}" fill="${esc(a.color)}"/><text x="50" y="${y}" text-anchor="middle" font-size="${fs}" style="font-family:system-ui,Apple Color Emoji,Segoe UI Emoji,sans-serif;paint-order:stroke;stroke:rgba(0,0,0,.15);stroke-width:0.5;">${esc(a.emoji)}</text></svg>`;
};
var avatarIcon = (avatar) => {
  const a = avatar !== null && typeof avatar === "object" ? avatar : defaultAvatar();
  return typeof a.emoji === "string" && a.emoji.length > 0 ? a.emoji : "\u{1F3AD}";
};
function apply(ctx) {
  let state = null;
  const fetchState = async () => {
    try {
      const res = await fetch(STATE_PATH, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      state = await res.json();
      render();
    } catch {
    }
  };
  let pollTimer = null;
  const startPoll = () => {
    clearInterval(pollTimer);
    pollTimer = setInterval(fetchState, 3e3);
  };
  let sse = null;
  const startSse = () => {
    try {
      sse = new EventSource(EVENTS_PATH);
      sse.onmessage = () => {
        void refreshRolesCache();
        fetchState();
      };
    } catch {
    }
  };
  const post = async (path, body) => {
    try {
      await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {})
      });
    } catch {
    }
    fetchState();
  };
  const mk = (tag, style, ...children) => {
    const n = document.createElement(tag);
    if (style) n.style.cssText = style;
    for (const c of children) {
      if (c === null || c === void 0) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  };
  const mkBtn = (label, onClick, primary = false) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = `padding:6px 12px; border-radius:8px; border:none; cursor:pointer; font-size:12px; color:${primary ? "#fff" : "#e8ebf2"}; background:${primary ? "#3b82f6" : "rgba(255,255,255,.1)"};`;
    b.addEventListener("click", onClick);
    return b;
  };
  const SECTION_LABELS = ["\u5DE5\u4F5C\u533A", "\u4F1A\u8BDD", "Workspace", "Sessions"];
  const findSectionLabel = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (el) => {
        if (el.children.length > 0) return NodeFilter.FILTER_SKIP;
        if (el.getAttribute && el.getAttribute("data-round-table") !== null) return NodeFilter.FILTER_REJECT;
        const t = (el.textContent ?? "").trim();
        return SECTION_LABELS.includes(t) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    return walker.nextNode();
  };
  const findLeftSidebarContainer = (label) => {
    let node = label;
    let best = null;
    while (node !== null && node !== document.body) {
      const rect = node.getBoundingClientRect();
      if (rect.left < 20 && rect.height > window.innerHeight * 0.5 && rect.width < window.innerWidth * 0.4) {
        best = node;
      }
      node = node.parentElement;
    }
    return best;
  };
  const leftSection = mk("div", "flex-shrink:0; max-height:200px; overflow-y:auto; padding:10px; border-top:1px solid rgba(255,255,255,.08); margin-top:6px;");
  leftSection.dataset.roundTable = "left";
  const leftHeader = mk("div", "display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;");
  const leftTitle = mk("div", "font-size:11px; color:#8a93a6; text-transform:uppercase; letter-spacing:.5px;", "\u5706\u684C\u6210\u5458");
  leftHeader.appendChild(leftTitle);
  const leftHint = mk("div", "font-size:10px; color:#6b7280;", "\u5728\u8F93\u5165\u6846 @ \u89D2\u8272\u540D \u5373\u53EF\u5BF9\u8BDD");
  leftHeader.appendChild(leftHint);
  leftSection.appendChild(leftHeader);
  const leftList = mk("div", "display:flex; flex-direction:column; gap:4px;");
  leftSection.appendChild(leftList);
  const leftActions = mk("div", "display:flex; flex-direction:column; gap:6px; margin-top:10px;");
  leftActions.appendChild(mkBtn("+ \u65B0\u5EFA\u89D2\u8272", () => openNewAgentModal()));
  leftSection.appendChild(leftActions);
  const injectLeft = () => {
    if (leftSection.isConnected) return;
    const regionRoot = document.querySelector('[class*="regionArea"] [class*="root"]');
    if (regionRoot !== null) {
      try {
        regionRoot.appendChild(leftSection);
        return;
      } catch {
      }
    }
    const regionArea = document.querySelector('[class*="regionArea"]');
    if (regionArea !== null) {
      try {
        regionArea.appendChild(leftSection);
        return;
      } catch {
      }
    }
    const label = findSectionLabel();
    const container = label !== null ? findLeftSidebarContainer(label) : null;
    if (container !== null) {
      try {
        container.appendChild(leftSection);
        return;
      } catch {
      }
    }
    const railRoot = document.querySelector('[class*="sidebarCol"] [class*="collapsed"]');
    if (railRoot !== null) {
      try {
        railRoot.appendChild(leftSection);
        return;
      } catch {
      }
    }
  };
  let injectQueued = false;
  const scheduleInjectLeft = () => {
    if (injectQueued) return;
    injectQueued = true;
    queueMicrotask(() => {
      injectQueued = false;
      injectLeft();
    });
  };
  const openNewAgentModal = (existing) => {
    const isEdit = existing !== void 0;
    const initial = isEdit ? { ...existing, avatar: { ...existing.avatar ?? defaultAvatar() }, soul: existing.soul ?? "" } : { name: "", title: "", description: "", systemPrompt: "", personality: "", soul: "", avatar: { shape: "circle", emoji: "\u{1F642}", color: nextColor() } };
    let draft = JSON.parse(JSON.stringify(initial));
    const overlay = mk("div", "position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:2147483002; display:flex; align-items:center; justify-content:center; font-family:system-ui,sans-serif;");
    const box = mk("div", "width:min(520px, calc(100vw - 40px)); max-height:84vh; background:#171a21; color:#e8ebf2; border-radius:14px; border:1px solid rgba(255,255,255,.12); padding:18px; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.5); overflow:auto;");
    overlay.appendChild(box);
    const title = mk("div", "font-size:16px; font-weight:600; margin-bottom:4px;", isEdit ? "\u7F16\u8F91\u89D2\u8272" : "New Agent");
    const subtitle = mk("div", "font-size:12px; color:#8a93a6; margin-bottom:14px;", "\u521B\u5EFA\u540E\u5728\u8F93\u5165\u6846\u8F93\u5165 @ \u5373\u53EF\u53EC\u5524\u8BE5\u89D2\u8272\u5BF9\u8BDD/\u53C2\u4E0E\u8BA8\u8BBA\u3002");
    box.appendChild(title);
    box.appendChild(subtitle);
    const previewBox = mk("div", "display:flex; align-items:center; justify-content:center; padding:12px 0; margin-bottom:8px;");
    const previewSvg = mk("div");
    previewBox.appendChild(previewSvg);
    box.appendChild(previewBox);
    const shapeRow = mk("div", "display:flex; gap:8px;");
    box.appendChild(mk("div", "font-size:11px; color:#8a93a6; margin:8px 0 6px;", "\u5F62\u72B6"));
    for (const s of SHAPES) {
      const btn = mk("button", `padding:6px; border-radius:8px; border:1px solid ${draft.avatar.shape === s ? "#3b82f6" : "rgba(255,255,255,.15)"}; background:${draft.avatar.shape === s ? "rgba(59,130,246,.2)" : "transparent"}; cursor:pointer;`);
      btn.innerHTML = renderAvatar({ ...draft.avatar, shape: s }, 36);
      btn.addEventListener("click", () => {
        draft.avatar.shape = s;
        render2();
      });
      shapeRow.appendChild(btn);
    }
    box.appendChild(shapeRow);
    const emojiRow = mk("div", "display:flex; flex-wrap:wrap; gap:6px;");
    box.appendChild(mk("div", "font-size:11px; color:#8a93a6; margin:12px 0 6px;", "\u8868\u60C5"));
    for (const e of EMOJIS) {
      const btn = mk("button", `width:38px; height:38px; border-radius:8px; border:1px solid ${draft.avatar.emoji === e ? "#3b82f6" : "rgba(255,255,255,.15)"}; background:${draft.avatar.emoji === e ? "rgba(59,130,246,.2)" : "transparent"}; cursor:pointer; font-size:20px; padding:0;`);
      btn.textContent = e;
      btn.addEventListener("click", () => {
        draft.avatar.emoji = e;
        render2();
      });
      emojiRow.appendChild(btn);
    }
    box.appendChild(emojiRow);
    const colorRow = mk("div", "display:flex; flex-wrap:wrap; gap:8px;");
    box.appendChild(mk("div", "font-size:11px; color:#8a93a6; margin:12px 0 6px;", "\u989C\u8272"));
    for (const c of PALETTE) {
      const btn = mk("button", `width:28px; height:28px; border-radius:50%; border:2px solid ${draft.avatar.color === c ? "#fff" : "transparent"}; background:${c}; cursor:pointer;`);
      btn.addEventListener("click", () => {
        draft.avatar.color = c;
        render2();
      });
      colorRow.appendChild(btn);
    }
    box.appendChild(colorRow);
    const mkField = (labelText, key, placeholder, isTextarea = false) => {
      const wrap = mk("div", "margin-top:12px;");
      wrap.appendChild(mk("div", "font-size:11px; color:#8a93a6; margin-bottom:4px;", labelText));
      const input = isTextarea ? mk("textarea") : mk("input");
      input.placeholder = placeholder;
      input.value = draft[key] ?? "";
      input.style.cssText = "width:100%; box-sizing:border-box; padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,.15); background:#22262e; color:#e8ebf2; font-size:13px; font-family:inherit;";
      if (isTextarea) input.style.minHeight = "52px";
      input.addEventListener("input", () => {
        draft[key] = input.value;
      });
      wrap.appendChild(input);
      return wrap;
    };
    box.appendChild(mkField("\u540D\u79F0\uFF08\u5FC5\u586B\uFF0C@ \u65F6\u8F93\u5165\u6B64\u540D\uFF09", "name", "\u5982\uFF1A\u67B6\u6784\u5E08"));
    box.appendChild(mkField("Title\uFF08\u53EF\u9009\uFF09", "title", "\u5982\uFF1AInbox Triage"));
    box.appendChild(mkField("\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09", "description", "\u8FD9\u4E2A\u89D2\u8272\u5E2E\u4EC0\u4E48\uFF1F", true));
    box.appendChild(mkField("System Prompt\uFF08\u89D2\u8272\u8BBE\u5B9A\uFF09", "systemPrompt", "\u6027\u683C\u3001\u7ACB\u573A\u3001\u4E13\u957F\u2026", true));
    box.appendChild(mkField("\u6027\u683C\u53C2\u6570\uFF08\u53EF\u9009\uFF09", "personality", "\u98CE\u9669\u504F\u597D\u3001\u8868\u8FBE\u98CE\u683C\u2026", true));
    const advToggle = mk("button", "margin-top:14px; width:100%; display:flex; align-items:center; justify-content:space-between; padding:9px 12px; border-radius:8px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.05); color:#c9d1de; cursor:pointer; font-size:13px;", "");
    const advToggleLabel = mk("span", "", "Advanced");
    const advToggleArrow = mk("span", "font-size:11px; color:#6b7280;", "\u2304 \u5C55\u5F00");
    advToggle.appendChild(advToggleLabel);
    advToggle.appendChild(advToggleArrow);
    box.appendChild(advToggle);
    const advBody = mk("div", "display:none; margin-top:10px;");
    box.appendChild(advBody);
    advBody.appendChild(mk("div", "font-size:11px; color:#8a93a6; margin:10px 0 4px;", "SOUL.md \u2014 \u89D2\u8272\u4EBA\u8BBE\u6587\u6863\uFF08@ \u65F6\u6CE8\u5165\uFF0C\u7559\u7A7A\u5219\u81EA\u52A8\u4ECE\u540D\u79F0/\u63CF\u8FF0\u5408\u6210\uFF0C\u4E0A\u9650 2000 \u5B57\uFF09"));
    const soulInput = mk("textarea");
    soulInput.placeholder = "# \u89D2\u8272\u7075\u9B42\n\u8FD9\u91CC\u5199\u8FD9\u4E2A\u89D2\u8272\u7684\u5B8C\u6574\u4EBA\u8BBE\u3001\u80CC\u666F\u6545\u4E8B\u3001\u7ACB\u573A\u3001\u7981\u5FCC\u2026";
    soulInput.value = draft.soul;
    soulInput.style.cssText = "width:100%; box-sizing:border-box; min-height:88px; resize:vertical; border-radius:8px; border:1px solid rgba(255,255,255,.15); background:#22262e; color:#e8ebf2; font-size:12px; font-family:inherit; padding:8px 10px;";
    soulInput.addEventListener("input", () => {
      draft.soul = soulInput.value;
    });
    advBody.appendChild(soulInput);
    const disabledHint = mk("div", "margin-top:12px; padding:8px 10px; border-radius:8px; background:rgba(255,255,255,.04); color:#6b7280; font-size:11px; line-height:1.6;", "\u5DE5\u5177/\u8BFB\u4EE3\u7801\u7B49\u80FD\u529B\u7531 DSH \u5BBF\u4E3B\u539F\u751F\u63D0\u4F9B\uFF08\u65E0\u9700\u5728\u6B64\u914D\u7F6E\uFF09\u3002Provider / Model \xB7 \u72EC\u7ACB API Key \xB7 Share keys & accounts \u2014\u2014 \u6682\u672A\u5F00\u653E\uFF08\u540E\u7EED\u7248\u672C\u652F\u6301\u89D2\u8272\u72EC\u7ACB\u6A21\u578B/\u51ED\u636E\uFF09");
    advBody.appendChild(disabledHint);
    advToggle.addEventListener("click", () => {
      const open = advBody.style.display === "block";
      advBody.style.display = open ? "none" : "block";
      advToggleArrow.textContent = open ? "\u2304 \u5C55\u5F00" : "\u2303 \u6536\u8D77";
    });
    const bar = mk("div", "display:flex; gap:8px; margin-top:16px; justify-content:flex-end;");
    if (isEdit) {
      const delBtn = mkBtn("\u5220\u9664", () => {
        if (window.confirm(`\u5220\u9664\u89D2\u8272\u300C${draft.name}\u300D\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`)) {
          post(`${ROUTE_PREFIX}/roles/delete`, { id: existing.id });
          overlay.remove();
        }
      }, false);
      delBtn.style.color = "#f87171";
      delBtn.style.border = "1px solid rgba(248,113,113,.4)";
      delBtn.style.background = "rgba(248,113,113,.12)";
      delBtn.style.marginRight = "auto";
      bar.appendChild(delBtn);
    }
    const cancel = mkBtn("\u53D6\u6D88", () => overlay.remove(), false);
    const submit = mkBtn(isEdit ? "\u4FDD\u5B58" : "\u521B\u5EFA", () => {
      const name2 = draft.name.trim();
      if (name2.length === 0) {
        window.alert("\u540D\u79F0\u5FC5\u586B");
        return;
      }
      const id = isEdit ? existing.id : `role-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      post(`${ROUTE_PREFIX}/roles`, { ...draft, id });
      overlay.remove();
    }, true);
    bar.appendChild(cancel);
    bar.appendChild(submit);
    box.appendChild(bar);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    render2();
    function render2() {
      previewSvg.innerHTML = renderAvatar(draft.avatar, 96);
      const shapes = shapeRow.children;
      for (let i = 0; i < shapes.length; i++) {
        const active = draft.avatar.shape === SHAPES[i];
        shapes[i].style.borderColor = active ? "#3b82f6" : "rgba(255,255,255,.15)";
        shapes[i].style.background = active ? "rgba(59,130,246,.2)" : "transparent";
        shapes[i].innerHTML = renderAvatar({ ...draft.avatar, shape: SHAPES[i] }, 36);
      }
      const emojis = emojiRow.children;
      for (let i = 0; i < emojis.length; i++) {
        const active = draft.avatar.emoji === EMOJIS[i];
        emojis[i].style.borderColor = active ? "#3b82f6" : "rgba(255,255,255,.15)";
        emojis[i].style.background = active ? "rgba(59,130,246,.2)" : "transparent";
      }
      const colors = colorRow.children;
      for (let i = 0; i < colors.length; i++) {
        const active = draft.avatar.color === PALETTE[i];
        colors[i].style.borderColor = active ? "#fff" : "transparent";
      }
    }
  };
  const render = () => {
    leftList.innerHTML = "";
    const roles = state?.roles ?? [];
    for (const role of roles) {
      const card = mk("div", "display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; cursor:pointer; font-size:13px; background:transparent; transition:background .15s;");
      card.dataset.rtKey = `role:${role.id}`;
      const avatarWrap = mk("span");
      avatarWrap.innerHTML = renderAvatar(role.avatar, 28);
      const nameWrap = mk("div", "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;");
      const nameLine = mk("div", "color:#e8ebf2; font-size:13px;", role.name);
      if (typeof role.soul === "string" && role.soul.length > 0) {
        nameLine.appendChild(mk("span", "color:#c77ce8; font-size:10px; margin-left:6px;", "\u{1F4C4}"));
      }
      const subLine = mk("div", "color:#6b7280; font-size:10px;", role.title || (role.systemPrompt ? role.systemPrompt.slice(0, 24) : "\u672A\u8BBE\u7F6E\u4EBA\u8BBE"));
      nameWrap.appendChild(nameLine);
      nameWrap.appendChild(subLine);
      card.addEventListener("click", () => insertMentionIntoInput(role.name));
      const editBtn = mk("button", "background:transparent; border:none; color:#6b7280; cursor:pointer; font-size:14px; padding:0 4px;", "\u22EF");
      editBtn.title = "\u7F16\u8F91";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openNewAgentModal(role);
      });
      card.appendChild(avatarWrap);
      card.appendChild(nameWrap);
      card.appendChild(editBtn);
      card.addEventListener("mouseenter", () => {
        card.style.background = "rgba(255,255,255,.06)";
      });
      card.addEventListener("mouseleave", () => {
        card.style.background = "transparent";
      });
      leftList.appendChild(card);
    }
    if (roles.length === 0) {
      const empty = mk("div", "font-size:11px; color:#6b7280; padding:8px; text-align:center; line-height:1.6;", "\u8FD8\u6CA1\u6709\u89D2\u8272\n\u70B9\u300C+ \u65B0\u5EFA\u89D2\u8272\u300D\u521B\u5EFA");
      empty.style.whiteSpace = "pre-line";
      leftList.appendChild(empty);
    }
  };
  const insertMentionIntoInput = (roleName) => {
    const targets = ["textarea", "input", '[contenteditable="true"]', '[contenteditable=""]'];
    let box = null;
    for (const sel of targets) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (!el.isConnected) continue;
        if (el.closest("[data-round-table]")) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > window.innerWidth * 0.4 && rect.bottom > window.innerHeight * 0.4) {
          box = el;
          break;
        }
      }
      if (box) break;
    }
    if (!box) {
      window.alert("\u672A\u627E\u5230\u8F93\u5165\u6846\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165 @" + roleName);
      return;
    }
    box.focus();
    if (box.tagName === "TEXTAREA" || box.tagName === "INPUT") {
      const text = box.value ?? "";
      const sep = text.length > 0 && !text.endsWith(" ") ? " " : "";
      box.value = text + sep + `@${roleName} `;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.setSelectionRange(box.value.length, box.value.length);
    } else {
      const sel = window.getSelection();
      const node = document.createTextNode(`@${roleName} `);
      sel?.getRangeAt(0)?.insertNode(node);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  let rolesCache = [];
  const refreshRolesCache = async () => {
    try {
      const res = await fetch(STATE_PATH, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      rolesCache = (await res.json()).roles ?? [];
    } catch {
    }
  };
  const registerMentionSource = () => {
    const inputTriggers = (typeof ctx?.get === "function" ? ctx.get("inputTriggers") : void 0) ?? (ctx !== void 0 ? ctx.inputTriggers : void 0);
    if (inputTriggers === void 0 || typeof inputTriggers.registerSource !== "function") {
      return void 0;
    }
    try {
      return inputTriggers.registerSource({
        trigger: "@",
        name: "\u5706\u684C\u89D2\u8272",
        order: -20,
        candidates: async (session, req) => {
          await refreshRolesCache();
          const q = (req?.query ?? "").trim();
          return rolesCache.filter((r) => r !== null && typeof r === "object" && typeof r.name === "string").filter((r) => q.length === 0 || r.name.toLowerCase().includes(q.toLowerCase())).map((r) => ({
            name: r.name,
            description: r.title || (typeof r.systemPrompt === "string" ? r.systemPrompt.slice(0, 32) : void 0),
            icon: avatarIcon(r.avatar),
            hint: "\u5706\u684C\u89D2\u8272"
          }));
        },
        onPick: (pick) => {
          const name2 = pick?.candidate?.name;
          if (typeof name2 !== "string" || name2.length === 0) return void 0;
          return { text: `@${name2} ` };
        },
        warm: () => {
          void refreshRolesCache();
        }
      });
    } catch (e) {
      try {
        console.error("[round-table] mention source register failed:", e);
      } catch {
      }
      return void 0;
    }
  };
  const domObserver = new MutationObserver(scheduleInjectLeft);
  domObserver.observe(document.body, { childList: true, subtree: true });
  scheduleInjectLeft();
  const disposeSource = (() => {
    const d = registerMentionSource();
    return typeof d === "function" ? d : () => {
    };
  })();
  void fetchState();
  startPoll();
  startSse();
  return () => {
    clearInterval(pollTimer);
    if (sse) sse.close();
    domObserver.disconnect();
    disposeSource();
    leftSection.remove();
  };
}
		return module.exports;
	}
});
