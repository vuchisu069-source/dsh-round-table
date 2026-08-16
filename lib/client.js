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
var PALETTE = ["#8b9dc3", "#e8a838", "#5fbf7a", "#d97c7c", "#7c8fe8", "#c77ce8", "#e87cb0", "#6fc7c7"];
var colorIdx = 0;
var nextColor = () => PALETTE[colorIdx++ % PALETTE.length];
var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[c]);
function apply() {
  let state = null;
  let currentRoomId = null;
  let composeMode = "manual";
  let composeText = "";
  let panelOpen = false;
  const fetchState = async () => {
    try {
      const res = await fetch(STATE_PATH, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      state = await res.json();
      if (!currentRoomId && state.rooms.length > 0) currentRoomId = state.rooms[0].id;
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
      sse.onmessage = () => fetchState();
    } catch {
    }
  };
  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(900px, calc(100vw - 32px)); height:min(560px, calc(100vh - 120px)); background:#171a21; color:#e8ebf2; border:1px solid rgba(255,255,255,.1); border-radius:14px; display:none; flex-direction:row; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.5); z-index:2147483000; font-family:system-ui,sans-serif;";
  document.body.appendChild(panel);
  const sidebarButton = document.createElement("button");
  sidebarButton.textContent = "\u5706\u684C";
  sidebarButton.title = "\u5706\u684C\uFF08\u591A\u65B9\u7814\u8BA8\uFF09";
  sidebarButton.style.cssText = "padding:1px 8px; border-radius:6px; border:none; cursor:pointer; font-size:11px; line-height:1.6; color:#e8ebf2; background:rgba(255,255,255,.14); margin-left:6px; flex-shrink:0;";
  sidebarButton.addEventListener("click", () => {
    panelOpen = !panelOpen;
    render();
  });
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
  const injectSidebarButton = () => {
    if (sidebarButton.isConnected) return true;
    const label = findSectionLabel();
    if (label !== null && label.parentElement !== null) {
      label.parentElement.insertBefore(sidebarButton, label.nextSibling);
      return true;
    }
    const railRoot = document.querySelector('[class*="sidebarCol"] [class*="collapsed"]');
    if (railRoot !== null) {
      railRoot.insertBefore(sidebarButton, railRoot.firstChild);
      return true;
    }
    return false;
  };
  let injectQueued = false;
  const scheduleInject = () => {
    if (injectQueued) return;
    injectQueued = true;
    queueMicrotask(() => {
      injectQueued = false;
      injectSidebarButton();
    });
  };
  const domObserver = new MutationObserver(scheduleInject);
  domObserver.observe(document.body, { childList: true, subtree: true });
  scheduleInject();
  const left = document.createElement("div");
  left.style.cssText = "width:220px; border-right:1px solid rgba(255,255,255,.08); padding:10px; overflow:auto; flex-shrink:0;";
  panel.appendChild(left);
  const middle = document.createElement("div");
  middle.style.cssText = "flex:1; display:flex; flex-direction:column; min-width:0;";
  panel.appendChild(middle);
  const timeline = document.createElement("div");
  timeline.style.cssText = "flex:1; overflow:auto; padding:12px;";
  middle.appendChild(timeline);
  const composer = document.createElement("div");
  composer.style.cssText = "border-top:1px solid rgba(255,255,255,.08); padding:10px;";
  middle.appendChild(composer);
  const right = document.createElement("div");
  right.style.cssText = "width:230px; border-left:1px solid rgba(255,255,255,.08); padding:10px; overflow:auto; flex-shrink:0;";
  panel.appendChild(right);
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
  const createRoleFlow = () => {
    const name2 = window.prompt("\u89D2\u8272\u540D\u79F0\uFF08\u5982\uFF1A\u67B6\u6784\u5E08\uFF09");
    if (!name2) return;
    const systemPrompt = window.prompt("System Prompt\uFF08\u89D2\u8272\u8BBE\u5B9A\uFF0C\u53EF\u7A7A\uFF09") ?? "";
    const personality = window.prompt("\u6027\u683C\u53C2\u6570\uFF08\u53EF\u7A7A\uFF09") ?? "";
    post(`${ROUTE_PREFIX}/roles`, { name: name2, color: nextColor(), systemPrompt, personality });
  };
  const createRoomFlow = () => {
    const title = window.prompt("\u623F\u95F4\u540D\u79F0\uFF08\u5982\uFF1A\u652F\u4ED8\u7F51\u5173\u9700\u6C42\u8BC4\u5BA1\uFF09");
    if (!title) return;
    const ids = state?.roles.map((r) => r.id) ?? [];
    const chosen = ids.filter((id) => window.confirm(`\u628A\u89D2\u8272\u300C${state.roles.find((r) => r.id === id).name}\u300D\u62C9\u5165\u623F\u95F4\uFF1F`));
    post(`${ROUTE_PREFIX}/rooms`, { title, memberRoleIds: chosen });
  };
  const sendMessage = () => {
    const text = composeText.trim();
    if (!text || !currentRoomId) return;
    const mentions = [];
    const matchAll = [...text.matchAll(/@([\w\u4e00-\u9fa5-]+)/g)];
    const room = state?.rooms.find((r) => r.id === currentRoomId);
    for (const m of matchAll) {
      const member = room?.members.find((mm) => (state.roles.find((r) => r.id === mm.roleId)?.name ?? "") === m[1]);
      if (member) mentions.push(member.id);
    }
    const mode = composeMode === "manual" && mentions.length === 0 ? "all" : composeMode;
    post(`${ROUTE_PREFIX}/messages`, { roomId: currentRoomId, mode, text, mentions });
    composeText = "";
    render();
  };
  const control = (action, value) => {
    if (!currentRoomId) return;
    post(`${ROUTE_PREFIX}/control`, { roomId: currentRoomId, action, value });
  };
  const addRoleFlow = () => {
    if (!currentRoomId) return;
    const ids = (state?.roles ?? []).map((r) => r.id);
    const chosen = ids.filter((id) => window.confirm(`\u628A\u89D2\u8272\u300C${state.roles.find((r) => r.id === id).name}\u300D\u52A0\u5165\u5F53\u524D\u623F\u95F4\uFF1F`));
    for (const roleId of chosen) post(`${ROUTE_PREFIX}/members`, { roomId: currentRoomId, roleId });
  };
  const addSessionFlow = async () => {
    if (!currentRoomId) return;
    let folders = [];
    try {
      const res = await fetch(`${ROUTE_PREFIX}/sessions`, { headers: { accept: "application/json" } });
      if (res.ok) folders = (await res.json()).folders ?? [];
    } catch {
    }
    const total = folders.reduce((n, f) => n + f.sessions.length, 0);
    if (total === 0) {
      window.alert("\u5DE5\u4F5C\u533A\u6682\u65E0\u53EF\u7528\u4F1A\u8BDD");
      return;
    }
    const room = state?.rooms.find((r) => r.id === currentRoomId);
    const taken = new Set((room?.members ?? []).filter((m) => m.sessionId).map((m) => m.sessionId));
    folders = folders.map((f) => ({ ...f, sessions: f.sessions.filter((s) => !taken.has(s.id)) })).filter((f) => f.sessions.length > 0);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:2147483001; display:flex; align-items:center; justify-content:center; font-family:system-ui,sans-serif;";
    const box = document.createElement("div");
    box.style.cssText = "width:min(680px, calc(100vw - 40px)); max-height:72vh; background:#171a21; color:#e8ebf2; border-radius:14px; border:1px solid rgba(255,255,255,.12); padding:16px; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.5);";
    const head = document.createElement("div");
    head.textContent = "\u9009\u62E9\u5DE5\u4F5C\u533A\u6587\u4EF6\u5939 \u2192 \u52FE\u9009\u8BE5\u6587\u4EF6\u5939\u4E0B\u7684\u5BF9\u8BDD\u6846";
    head.style.cssText = "font-size:14px; font-weight:600; margin-bottom:10px;";
    box.appendChild(head);
    const body = document.createElement("div");
    body.style.cssText = "display:flex; gap:10px; flex:1; min-height:0;";
    box.appendChild(body);
    const folderPane = document.createElement("div");
    folderPane.style.cssText = "width:200px; flex-shrink:0; overflow:auto; border-right:1px solid rgba(255,255,255,.08); padding-right:8px;";
    body.appendChild(folderPane);
    const sessionPane = document.createElement("div");
    sessionPane.style.cssText = "flex:1; overflow:auto; min-width:0;";
    body.appendChild(sessionPane);
    let selectedFolder = folders[0]?.path ?? null;
    const checks = [];
    const renderFolders = () => {
      folderPane.innerHTML = "";
      for (const f of folders) {
        const row = document.createElement("div");
        const base = f.path.split("/").filter(Boolean).pop() || f.path;
        row.textContent = `\u{1F4C1} ${base}\uFF08${f.sessions.length}\uFF09`;
        row.title = f.path;
        row.style.cssText = `padding:7px 8px; border-radius:8px; cursor:pointer; font-size:13px; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:${f.path === selectedFolder ? "rgba(59,130,246,.25)" : "transparent"};`;
        row.addEventListener("click", () => {
          selectedFolder = f.path;
          renderFolders();
          renderSessions();
        });
        folderPane.appendChild(row);
      }
    };
    const renderSessions = () => {
      sessionPane.innerHTML = "";
      checks.length = 0;
      const folder = folders.find((f) => f.path === selectedFolder);
      if (!folder) {
        sessionPane.textContent = "\u2190 \u9009\u62E9\u4E00\u4E2A\u6587\u4EF6\u5939";
        sessionPane.style.cssText = "flex:1; color:#8a93a6; font-size:12px; padding:8px;";
        updateOk();
        return;
      }
      sessionPane.style.cssText = "flex:1; overflow:auto; min-width:0;";
      const folderHead = document.createElement("div");
      folderHead.textContent = folder.path;
      folderHead.style.cssText = "font-size:11px; color:#8a93a6; margin-bottom:8px; word-break:break-all;";
      sessionPane.appendChild(folderHead);
      for (const s of folder.sessions) {
        const row = document.createElement("label");
        row.style.cssText = "display:flex; align-items:center; gap:8px; padding:7px 6px; border-radius:8px; cursor:pointer; font-size:13px;";
        row.addEventListener("mouseenter", () => {
          row.style.background = "rgba(255,255,255,.07)";
        });
        row.addEventListener("mouseleave", () => {
          row.style.background = "transparent";
        });
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.style.cssText = "accent-color:#3b82f6; flex-shrink:0;";
        const txt = document.createElement("span");
        txt.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1;";
        txt.textContent = s.title;
        txt.title = s.id;
        row.appendChild(cb);
        row.appendChild(txt);
        sessionPane.appendChild(row);
        checks.push({ cb, id: s.id });
        cb.addEventListener("change", updateOk);
      }
      updateOk();
    };
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex; gap:8px; margin-top:12px; justify-content:flex-end; align-items:center;";
    const selHint = document.createElement("span");
    selHint.style.cssText = "font-size:11px; color:#6b7280; margin-right:auto;";
    const mkBtn = (label, primary) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `padding:6px 16px; border-radius:8px; border:none; cursor:pointer; font-size:13px; color:#e8ebf2; background:${primary ? "#3b82f6" : "rgba(255,255,255,.12)"};`;
      return b;
    };
    const cancel = mkBtn("\u53D6\u6D88", false);
    cancel.addEventListener("click", () => overlay.remove());
    const ok = mkBtn("\u52A0\u5165\uFF080\uFF09", true);
    const updateOk = () => {
      const n = checks.filter((c) => c.cb.checked).length;
      ok.textContent = `\u52A0\u5165\uFF08${n}\uFF09`;
      selHint.textContent = n > 0 ? `\u5DF2\u9009 ${n} \u4E2A\u5BF9\u8BDD\u6846\uFF08\u6765\u81EA ${selectedFolder}\uFF09` : "\u5728\u53F3\u4FA7\u52FE\u9009\u8981\u62C9\u5165\u7684\u5BF9\u8BDD\u6846";
    };
    ok.addEventListener("click", () => {
      const chosen = checks.filter((c) => c.cb.checked).map((c) => c.id);
      overlay.remove();
      if (chosen.length === 0) return;
      for (const id of chosen) post(`${ROUTE_PREFIX}/members`, { roomId: currentRoomId, sessionId: id });
    });
    bar.appendChild(selHint);
    bar.appendChild(cancel);
    bar.appendChild(ok);
    box.appendChild(bar);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    renderFolders();
    renderSessions();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && currentRoomId) {
      post(`${ROUTE_PREFIX}/presence`, { roomId: currentRoomId, visible: false });
    }
  });
  const render = () => {
    panel.style.display = panelOpen ? "flex" : "none";
    if (!panelOpen || !state) return;
    renderLeft();
    renderTimeline();
    renderRight();
    renderComposer();
  };
  const renderLeft = () => {
    left.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = "\u623F\u95F4 / \u89D2\u8272";
    title.style.cssText = "font-size:12px; color:#8a93a6; margin-bottom:8px;";
    left.appendChild(title);
    for (const room of state.rooms) {
      const row = document.createElement("div");
      row.textContent = `${room.paused ? "\u23F8 " : ""}${esc(room.title)}\uFF08${room.round}/${room.maxRounds}\u8F6E\uFF09`;
      row.style.cssText = `padding:7px 8px; border-radius:8px; cursor:pointer; font-size:13px; margin-bottom:4px; background:${room.id === currentRoomId ? "rgba(255,255,255,.12)" : "transparent"};`;
      row.addEventListener("click", () => {
        currentRoomId = room.id;
        render();
      });
      left.appendChild(row);
    }
    const newRoom = button("+ \u65B0\u5EFA\u623F\u95F4", () => createRoomFlow());
    left.appendChild(newRoom);
    const hr = document.createElement("div");
    hr.style.cssText = "height:1px; background:rgba(255,255,255,.08); margin:10px 0;";
    left.appendChild(hr);
    for (const role of state.roles) {
      const row = document.createElement("div");
      row.style.cssText = "padding:5px 8px; font-size:12px; color:#aeb6c4;";
      row.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${esc(role.color)};margin-right:6px;"></span>${esc(role.name)}`;
      left.appendChild(row);
    }
    left.appendChild(button("+ \u65B0\u5EFA\u89D2\u8272", () => createRoleFlow()));
  };
  const renderTimeline = () => {
    timeline.innerHTML = "";
    const room = state.rooms.find((r) => r.id === currentRoomId);
    if (!room) {
      timeline.textContent = "\u2190 \u9009\u62E9\u4E00\u4E2A\u623F\u95F4\uFF0C\u6216\u65B0\u5EFA\u623F\u95F4";
      timeline.style.cssText = "flex:1; padding:24px; color:#8a93a6; font-size:13px;";
      return;
    }
    timeline.style.cssText = "flex:1; overflow:auto; padding:12px;";
    const head = document.createElement("div");
    head.style.cssText = "font-size:15px; font-weight:600; margin-bottom:10px;";
    head.textContent = `${esc(room.title)}\u3000\xB7\u3000${room.mode} \u6A21\u5F0F\u3000\xB7\u3000\u7B2C ${room.round}/${room.maxRounds} \u8F6E${room.paused ? "\u3000\u23F8 \u5DF2\u6682\u505C" : ""}${room.running ? "\u3000\u23F3 \u7814\u8BA8\u4E2D" : ""}`;
    timeline.appendChild(head);
    for (const msg of room.messages) {
      const row = document.createElement("div");
      row.style.cssText = "margin-bottom:8px; font-size:13px; line-height:1.55;";
      if (msg.kind === "user") {
        row.style.cssText += "text-align:right;";
        row.innerHTML = `<span style="display:inline-block;max-width:78%;background:#2f3542;border-radius:10px;padding:7px 10px;text-align:left;white-space:pre-wrap;">${esc(msg.text)}</span>`;
      } else if (msg.kind === "agent") {
        row.innerHTML = `<div style="display:inline-block;max-width:82%;background:rgba(255,255,255,.06);border-radius:10px;padding:7px 10px;white-space:pre-wrap;"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${esc(msg.color)};margin-right:6px;"></span><b style="color:${esc(msg.color)};">${esc(msg.authorName)}</b><span style="color:#6b7280;margin-left:6px;font-size:11px;">\u7B2C${msg.round ?? "?"}\u8F6E</span><br>${esc(msg.text)}</div>`;
      } else {
        row.style.cssText = "text-align:center; color:#6b7280; font-size:12px;";
        row.textContent = msg.text;
      }
      timeline.appendChild(row);
    }
    timeline.scrollTop = timeline.scrollHeight;
  };
  const renderRight = () => {
    right.innerHTML = "";
    const room = state.rooms.find((r) => r.id === currentRoomId);
    if (!room) {
      const hint = document.createElement("div");
      hint.textContent = state.rooms.length === 0 ? "\u8FD8\u6CA1\u6709\u623F\u95F4\uFF1A\n\u5728\u5DE6\u680F\u300C+ \u65B0\u5EFA\u623F\u95F4\u300D\u521B\u5EFA\u4E00\u4E2A\uFF0C\n\u6216\u5148\u300C+ \u65B0\u5EFA\u89D2\u8272\u300D\u3002" : "\u2190 \u5728\u5DE6\u680F\u9009\u62E9\u4E00\u4E2A\u623F\u95F4";
      hint.style.cssText = "font-size:12px; color:#8a93a6; white-space:pre-line; line-height:1.7; padding:8px;";
      right.appendChild(hint);
      return;
    }
    const title = document.createElement("div");
    title.textContent = "\u6210\u5458 / \u63A7\u5236";
    title.style.cssText = "font-size:12px; color:#8a93a6; margin-bottom:8px;";
    right.appendChild(title);
    for (const member of room.members) {
      const isSession = member.kind === "session";
      const name2 = isSession ? member.title ?? member.sessionId : state.roles.find((r) => r.id === member.roleId)?.name ?? member.id;
      const color = isSession ? "#7c8fe8" : state.roles.find((r) => r.id === member.roleId)?.color ?? "#8b9dc3";
      const dot = member.status === "thinking" ? "\u{1F7E1}" : member.status === "error" ? "\u{1F534}" : "\u{1F7E2}";
      const icon = isSession ? "\u{1F4AC}" : "\u{1F3AD}";
      const row = document.createElement("div");
      row.textContent = `${icon} ${dot} ${name2}${member.status === "thinking" ? "\uFF08\u601D\u8003\u4E2D\uFF09" : ""}`;
      row.style.cssText = `padding:5px 8px; font-size:12px; color:${color};`;
      right.appendChild(row);
    }
    right.appendChild(button("+ \u52A0\u5165\u89D2\u8272\uFF08\u81EA\u5EFA\uFF09", () => addRoleFlow()));
    right.appendChild(button("+ \u52A0\u5165\u5DE5\u4F5C\u533A\u5BF9\u8BDD\u6846", () => addSessionFlow()));
    const hr = document.createElement("div");
    hr.style.cssText = "height:1px; background:rgba(255,255,255,.08); margin:10px 0;";
    right.appendChild(hr);
    right.appendChild(button(room.paused ? "\u25B6 \u7EE7\u7EED" : "\u23F8 \u6682\u505C", () => control(room.paused ? "resume" : "pause")));
    right.appendChild(button("\u{1F4DD} \u4E00\u952E\u603B\u7ED3", () => control("summarize")));
    const rounds = document.createElement("input");
    rounds.type = "number";
    rounds.min = 1;
    rounds.max = 20;
    rounds.value = room.maxRounds;
    rounds.style.cssText = "width:100%; box-sizing:border-box; margin-top:8px; padding:6px 8px; border-radius:8px; border:1px solid rgba(255,255,255,.15); background:#22262e; color:#e8ebf2; font-size:13px;";
    rounds.addEventListener("change", () => control("setRounds", Number(rounds.value)));
    right.appendChild(rounds);
    const roundsLabel = document.createElement("div");
    roundsLabel.textContent = "\u6700\u5927\u8F6E\u6570\uFF08\u9632\u6B7B\u5FAA\u73AF\u4E0A\u9650\uFF09";
    roundsLabel.style.cssText = "font-size:11px; color:#6b7280; margin-top:4px;";
    right.appendChild(roundsLabel);
    if (room.summaries.length > 0) {
      const hr2 = document.createElement("div");
      hr2.style.cssText = "height:1px; background:rgba(255,255,255,.08); margin:10px 0;";
      right.appendChild(hr2);
      for (const s of room.summaries) {
        const card = document.createElement("div");
        card.textContent = s.text;
        card.style.cssText = "font-size:11px; color:#c9d1de; background:rgba(255,255,255,.05); border-radius:8px; padding:6px 8px; margin-bottom:6px; white-space:pre-wrap; max-height:200px; overflow:auto;";
        right.appendChild(card);
      }
    }
  };
  const button = (label, onClick) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "display:block; width:100%; margin-top:6px; padding:6px 8px; border-radius:8px; border:none; cursor:pointer; font-size:12px; color:#e8ebf2; background:rgba(255,255,255,.1); text-align:left;";
    b.addEventListener("click", onClick);
    return b;
  };
  const modeBar = document.createElement("div");
  modeBar.style.cssText = "display:flex; gap:6px; margin-bottom:6px;";
  composer.appendChild(modeBar);
  const textarea = document.createElement("textarea");
  textarea.placeholder = "\u8F93\u5165\u8BAE\u9898\u2026\uFF08@\u89D2\u8272\u540D \u53EF\u6307\u5B9A\u53D1\u8A00\uFF1B\u7A7A @ \u65F6\u9ED8\u8BA4\u5168\u4F53\u7814\u8BA8\uFF09";
  textarea.style.cssText = "width:100%; box-sizing:border-box; min-height:52px; resize:vertical; border-radius:8px; border:1px solid rgba(255,255,255,.15); background:#22262e; color:#e8ebf2; padding:8px; font-size:13px; font-family:inherit;";
  textarea.addEventListener("input", () => {
    composeText = textarea.value;
  });
  composer.appendChild(textarea);
  const sendBar = document.createElement("div");
  sendBar.style.cssText = "display:flex; gap:6px; margin-top:6px; align-items:center;";
  composer.appendChild(sendBar);
  for (const [value, label] of [["manual", "@ \u6307\u5B9A"], ["all", "\u5168\u4F53\u7814\u8BA8"], ["chain", "\u63A5\u529B\u94FE"]]) {
    const chip = document.createElement("button");
    chip.textContent = label;
    chip.style.cssText = `padding:4px 10px; border-radius:14px; border:none; cursor:pointer; font-size:12px; color:#e8ebf2; background:${composeMode === value ? "#3b82f6" : "rgba(255,255,255,.1)"};`;
    chip.addEventListener("click", () => {
      composeMode = value;
      render();
    });
    modeBar.appendChild(chip);
  }
  const sendBtn = document.createElement("button");
  sendBtn.textContent = "\u53D1\u9001";
  sendBtn.style.cssText = "padding:6px 16px; border-radius:8px; border:none; cursor:pointer; font-size:13px; color:#fff; background:#3b82f6;";
  sendBtn.addEventListener("click", sendMessage);
  sendBar.appendChild(sendBtn);
  const modeNote = document.createElement("span");
  modeNote.style.cssText = "font-size:11px; color:#6b7280;";
  sendBar.appendChild(modeNote);
  const renderComposer = () => {
    modeNote.textContent = composeMode === "manual" ? "\u6587\u672C\u4E2D @ \u89D2\u8272\u540D\u5373\u70B9\u540D\u53D1\u8A00" : composeMode === "all" ? "\u6240\u6709\u6210\u5458\u6309\u5E8F\u5404\u53D1\u8A00\u4E00\u6B21\uFF081 \u8F6E\uFF09" : "\u94FE\u5F0F\uFF1AA \u8F93\u51FA\u4F5C\u4E3A B \u7684\u4E0A\u4E0B\u6587\uFF08\u8F6E\u6B21\u4E0A\u9650\u63A7\u5236\uFF09";
    const active = composeMode === "manual" ? "@ \u6307\u5B9A" : composeMode === "all" ? "\u5168\u4F53\u7814\u8BA8" : "\u63A5\u529B\u94FE";
    for (const chip of modeBar.children) {
      chip.style.background = chip.textContent === active ? "#3b82f6" : "rgba(255,255,255,.1)";
    }
  };
  document.body.appendChild(root);
  void fetchState();
  startPoll();
  startSse();
  return () => {
    clearInterval(pollTimer);
    if (sse) sse.close();
    domObserver.disconnect();
    sidebarButton.remove();
    panel.remove();
  };
}
		return module.exports;
	}
});
