/* Disney Day Planner: schedule engine, optional shared state, UI. Vanilla JS, no build. */
(function () {
  const D = window.DD; // built from the setup answers by main.js (planner.js)
  const DAY = D.DAY;
  const CFG = window.DD_CONFIG || {};
  /* Optional group sharing. Off unless a Supabase URL and publishable key are set (config.js or the Settings tab). */
  const SB = (() => {
    let own = {}; try { own = JSON.parse(localStorage.getItem("dd-sync") || "{}"); } catch (e) { }
    const c = CFG.sharing || {};
    return { url: (own.url || c.url || "").replace(/\/+$/, ""), key: own.key || c.key || "", slug: own.slug || "" };
  })();
  const SYNC_ON = !!(SB.url && SB.key && SB.slug);

  /* ---------- state ---------- */
  const blank = () => ({
    statuses: {}, doneAt: {}, who: {}, pinned: {}, order: D.PLAN.map(p => p.id), prefs: { ...D.DEFAULT_PREFS, heights: {} },
    holdUntil: null, llReturn: {}, profile: D.PROFILE, updatedAt: null,
  });
  let state = blank();
  let local = { nowOverride: null, tab: "now", remoteAt: null, syncStatus: SYNC_ON ? "…" : "this phone", base: CFG.disneyMapTiles === false ? "street" : "park" };
  try {
    const cached = localStorage.getItem("dd-state"); if (cached) state = { ...blank(), ...JSON.parse(cached) };
    const l = localStorage.getItem("dd-local"); if (l) local = { ...local, ...JSON.parse(l) };
  } catch (e) { /* storage unavailable */ }

  const ITEMS = {}; D.PLAN.concat(D.BONUS).forEach(i => ITEMS[i.id] = i);

  /* ---------- time ---------- */
  const pad = n => String(n).padStart(2, "0");
  const fmt = m => { if (m == null || !isFinite(m)) return "—"; let h = Math.floor(m / 60) % 24, mm = Math.round(m % 60); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${pad(mm)} ${ap}`; };
  const isTheDay = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}` === DAY; };
  const dateLabel = () => { const [y, m, d] = DAY.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }); };
  const realNow = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
  const now = () => local.nowOverride != null ? local.nowOverride : (isTheDay() ? realNow() : D.START - 15);

  /* ---------- people / heights ---------- */
  const inches = p => (state.prefs.heights && state.prefs.heights[p]) || D.PEOPLE[p].inches;
  const canRide = (p, item) => !item.minInches || inches(p) >= item.minInches;
  const whoFor = item => (state.who[item.id] || item.who).filter(p => canRide(p, item));
  const needsSwitch = item => !!item.minInches && item.who.some(p => !canRide(p, item)) && whoFor(item).some(p => D.PEOPLE[p].role === "adult");

  /* ---------- engine ---------- */
  function effPriority(item) {
    let p = item.priority || 3; const lean = state.prefs.lean;
    if (lean === "characters") { if (item.kind === "meet") p += 1; if (item.kind === "ride") p -= 0.5; }
    if (lean === "rides") { if (item.kind === "ride") p += 1; if (item.kind === "meet") p -= 0.5; }
    if (lean === "rest") { if (item.kind === "break" || item.kind === "show" || item.kind === "treat") p += 1; if (item.kind === "ride") p -= 0.5; }
    return p;
  }

  function compute() {
    const nowM = now();
    const order = state.order.filter(id => ITEMS[id]);
    const active = order.filter(id => state.statuses[id] !== "skipped" && !(id === "nap" && !state.prefs.napOn));
    const done = active.filter(id => state.statuses[id] === "done");
    let dropped = new Set();
    let result;
    for (let guard = 0; guard < 40; guard++) {
      result = run(place(active.filter(id => !dropped.has(id)), nowM), nowM);
      const exit = result.rows.find(r => r.id === "exit");
      const over = exit && exit.start > state.prefs.departure + 10;
      if (!over) break;
      const cands = result.rows.filter(r => !r.done && !ITEMS[r.id].lock && !state.pinned[r.id] && ITEMS[r.id].kind !== "task")
        .sort((a, b) => effPriority(ITEMS[a.id]) - effPriority(ITEMS[b.id]) || b.dur - a.dur);
      if (!cands.length) break;
      dropped.add(cands[0].id);
    }
    result.dropped = [...dropped];
    result.done = done;
    return result;
  }

  // "2:15-3:15", "2:15 pm - 3:15 pm", "12:40-1:40" -> minutes from midnight. Bare hours 1 to 7 are afternoon.
  function parseWin(s) {
    const h = (hh, mm, ap) => { let x = +hh % 12; if (ap ? ap.toLowerCase() === "p" : +hh < 8) x += 12; return x * 60 + (+mm || 0); };
    const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?/i.exec(s || "");
    if (m) { const a = h(m[1], m[2], m[3] || m[6]), b = h(m[4], m[5], m[6] || m[3]); return b > a ? [a, b] : null; }
    const one = /(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?/i.exec(s || ""); // a single time: Disney windows are one hour
    if (one) { const a = h(one[1], one[2], one[3]); return [a, a + 60]; }
    return null;
  }
  // Put Lightning Lane rides with a typed window, and the booking to-dos after the first, where the day actually reaches them.
  function place(ids, nowM) {
    const pending = id => state.statuses[id] !== "done";
    const winOf = id => ITEMS[id].ll === true && pending(id) ? parseWin(state.llReturn[id]) : null;
    const rides = ids.filter(winOf).sort((a, b) => winOf(a)[0] - winOf(b)[0]);
    const books = ids.filter(id => ITEMS[id].ll === "book");
    const auto = books.filter((id, i) => i > 0 && pending(id));
    let base = ids.filter(id => !rides.includes(id) && !auto.includes(id));
    const insertAt = (id, at, overMeals) => {
      const r = run(base, nowM);
      const row = r.rows.find(x => !x.done && x.id !== "exit" && (overMeals ? ITEMS[x.id].kind !== "travel" : !ITEMS[x.id].lock) && x.start >= at);
      const i = row ? base.indexOf(row.id) : base.indexOf("exit");
      base.splice(i < 0 ? base.length : i, 0, id);
    };
    rides.forEach(id => insertAt(id, winOf(id)[0] - 5));
    auto.forEach(id => {
      const n = books.indexOf(id); const prev = books[n - 1]; const r = run(base, nowM);
      const prevRow = r.rows.find(x => x.id === prev);
      const prevAt = prevRow ? prevRow.start : (state.doneAt[prev] || nowM);
      const ride = rides[n - 1]; const rideRow = ride && r.rows.find(x => x.id === ride); // the ride that booking opened; scanning in frees the next booking
      const open = Math.min(prevAt + 120, rideRow ? rideRow.start + 1 : Infinity); // +1: after scanning in, not before
      insertAt(id, open, true); // a phone to-do can sit before lunch; a ride never splits a meal
    });
    return base;
  }
  function run(ids, nowM) {
    const rows = []; const missed = [];
    let t = 0, curLand = "car";
    // done items keep their recorded times
    let lastDoneEnd = null;
    ids.forEach(id => {
      const item = ITEMS[id];
      if (state.statuses[id] === "done") {
        const at = state.doneAt[id] != null ? state.doneAt[id] : nowM;
        rows.push({ id, start: at - item.dur, end: at, dur: item.dur, done: true, walk: 0 });
        lastDoneEnd = at; curLand = item.endLand || item.land;
      }
    });
    const pending = ids.filter(id => state.statuses[id] !== "done");
    t = Math.max(lastDoneEnd != null ? lastDoneEnd : 0, nowM, state.holdUntil || 0);
    if (!isTheDay() && local.nowOverride == null) t = D.START;
    const deferred = [];
    const queue = pending.slice();
    while (queue.length) {
      const id = queue.shift(); const item = ITEMS[id];
      // A booking to-do happens on the phone wherever you stand: no walk, and it does not move you.
      const onPhone = item.ll === "book";
      const walk = onPhone ? 0 : D.WALK[curLand] && isFinite(D.WALK[curLand][item.land]) ? D.WALK[curLand][item.land] : 5;
      const earliest = t + walk;
      let start, dur = item.dur, slot = null;
      const win = (item.ll === true && parseWin(state.llReturn[id])) || item.window;
      if (item.fixedAt != null) start = Math.max(earliest, item.fixedAt);
      else if (item.times) {
        slot = item.times.find(s => s - (item.arriveEarly || 0) >= earliest);
        if (slot == null) { missed.push(id); continue; }
        start = slot - (item.arriveEarly || 0); dur = item.dur + (item.arriveEarly || 0);
      } else if (win) {
        start = Math.max(earliest, win[0]);
        if (start > win[1]) { missed.push(id); continue; }
      } else start = earliest;
      // Look-ahead: would this flexible item make us miss a show we could catch right now?
      if (!item.lock && !item.times && item.fixedAt == null) {
        const nxt = queue.slice(0, 3).find(q => ITEMS[q].times);
        if (nxt && !deferred.includes(id)) {
          const show = ITEMS[nxt];
          const w1 = D.WALK[curLand][show.land] || 5, w2 = D.WALK[item.land][show.land] || 5;
          const early = show.arriveEarly || 0;
          const catchNow = show.times.find(s => s - early >= t + w1);
          const catchAfter = show.times.find(s => s - early >= start + dur + w2);
          const idle = catchNow != null ? (catchNow - early) - (t + w1) : Infinity;
          if (catchNow != null && catchAfter !== catchNow && idle <= 30 && effPriority(show) >= effPriority(item)) {
            deferred.push(id); queue.splice(queue.indexOf(nxt) + 1, 0, id); continue;
          }
        }
      }
      // Shrinkable breaks: cut a break short to catch the next show.
      if (item.minDur && !item.times) {
        const nxt = queue.slice(0, 3).find(q => ITEMS[q].times);
        if (nxt) {
          const show = ITEMS[nxt]; const early = show.arriveEarly || 0; const w2 = D.WALK[item.endLand || item.land][show.land] || 5;
          const full = show.times.find(s => s - early >= start + dur + w2);
          const short = show.times.find(s => s - early >= start + item.minDur + w2);
          if (short != null && short !== full) dur = Math.max(item.minDur, (short - early) - w2 - start);
        }
      }
      rows.push({ id, start, end: start + dur, dur, walk, slot, done: false });
      t = start + dur; if (!onPhone) curLand = item.endLand || item.land;
    }
    return { rows, missed };
  }

  /* ---------- sync ---------- */
  let saveTimer = null;
  function persistLocal() { try { localStorage.setItem("dd-state", JSON.stringify(state)); localStorage.setItem("dd-local", JSON.stringify(local)); } catch (e) { } }
  function commit() { state.updatedAt = new Date().toISOString(); persistLocal(); render(); clearTimeout(saveTimer); if (SYNC_ON) saveTimer = setTimeout(push, 400); }
  let acked = null; // the plan as the server last confirmed it, so edits from two phones can be merged
  const clone = o => JSON.parse(JSON.stringify(o));
  const ts = v => Date.parse(v || 0) || 0;
  function mergeStates(remote, base, mine) {
    // Start from the other phone's plan, then re-apply only what changed on this phone since the last confirmed save.
    const out = clone(remote);
    Object.keys(mine).forEach(k => {
      if (k === "updatedAt") return;
      const m = mine[k], b = base ? base[k] : undefined;
      if (m && typeof m === "object" && !Array.isArray(m)) {
        out[k] = out[k] && typeof out[k] === "object" ? out[k] : {};
        const keys = new Set(Object.keys(m).concat(b && typeof b === "object" ? Object.keys(b) : []));
        keys.forEach(sk => { const mv = JSON.stringify(m[sk]), bv = JSON.stringify(b ? b[sk] : undefined); if (mv !== bv) { if (m[sk] === undefined) delete out[k][sk]; else out[k][sk] = m[sk]; } });
      } else if (JSON.stringify(m) !== JSON.stringify(b)) out[k] = m;
    });
    return out;
  }
  let force = false; try { force = localStorage.getItem("dd-force-push") === "1"; } catch (e) { }
  async function push() {
    if (!SYNC_ON) return;
    try {
      // Re-read the server first. If another phone saved since our last confirmed copy, merge before writing so nobody's edit is erased.
      const r0 = force ? { ok: false } : await fetch(`${SB.url}/rest/v1/disney_plan?slug=eq.${SB.slug}&select=state,updated_at`, { headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}` } });
      if (r0.ok) { const rows0 = await r0.json();
        if (rows0.length && ts(rows0[0].updated_at) > ts(acked ? acked.updatedAt : 0)) {
          const base = acked || blank();
          state = { ...blank(), ...mergeStates(rows0[0].state, base, state), updatedAt: new Date().toISOString() };
          acked = { ...clone(rows0[0].state), updatedAt: rows0[0].updated_at }; persistLocal(); render();
        } }
    } catch (e) { }
    const sent = clone(state);
    try {
      const r = await fetch(`${SB.url}/rest/v1/disney_plan`, {
        method: "POST", headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ slug: SB.slug, state: sent, updated_at: sent.updatedAt }]),
      });
      if (r.ok) { acked = sent; local.remoteAt = sent.updatedAt; local.syncStatus = "synced"; if (force) { force = false; try { localStorage.removeItem("dd-force-push"); } catch (e) { } } }
      else local.syncStatus = "save failed";
    } catch (e) { local.syncStatus = "offline"; }
    renderSync(); if (modal) renderModal();
  }
  async function pull() {
    if (!SYNC_ON) return;
    try {
      const r = await fetch(`${SB.url}/rest/v1/disney_plan?slug=eq.${SB.slug}&select=state,updated_at`, { headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}` } });
      if (!r.ok) throw new Error(r.status);
      const rows = await r.json();
      if (rows.length) {
        const remote = rows[0];
        const pending = acked && JSON.stringify({ ...state, updatedAt: 0 }) !== JSON.stringify({ ...acked, updatedAt: 0 });
        if (!force && remote.state.profile && JSON.stringify(remote.state.profile) !== JSON.stringify(D.PROFILE) && ts(remote.updated_at) > ts(state.updatedAt)) {
          // Someone in the group redid the setup. Adopt their trip details and rebuild this phone's plan.
          try { localStorage.setItem("dd-profile", JSON.stringify(remote.state.profile)); localStorage.setItem("dd-state", JSON.stringify({ ...remote.state, updatedAt: remote.updated_at })); } catch (e) { }
          location.reload(); return;
        }
        if (!state.updatedAt || ts(remote.updated_at) > ts(state.updatedAt)) {
          if (pending) {
            // Another phone saved while this one had unsaved edits: keep both.
            state = { ...blank(), ...mergeStates(remote.state, acked, state), updatedAt: new Date().toISOString() };
            acked = clone(remote.state); persistLocal(); render(); push(); return;
          }
          state = { ...blank(), ...remote.state, updatedAt: remote.updated_at }; acked = clone(state); persistLocal(); render();
          local.syncStatus = "synced";
        } else if (ts(remote.updated_at) < ts(state.updatedAt)) { push(); return; }
        else { if (!acked) acked = clone(state); local.syncStatus = "synced"; }
      } else { if (!state.updatedAt) state.updatedAt = new Date().toISOString(); persistLocal(); push(); return; }
    } catch (e) { local.syncStatus = "offline"; }
    renderSync();
  }

  function applySwap(st, id, nid) {
    if (!nid || nid === id) return false;
    const i = st.order.indexOf(id); if (i < 0) return false;
    st.order = st.order.filter(x => x !== nid); delete st.statuses[nid];
    const j = st.order.indexOf(id);
    if (D.PLAN.find(p => p.id === id)) { st.statuses[id] = "skipped"; st.order.splice(j + 1, 0, nid); }
    else { st.order.splice(j, 1, nid); delete st.statuses[id]; }
    return true;
  }
  function previewSwap(id, nid) {
    // Run the planner on a copy of the plan with the swap applied, so the dropdown can say what the swap does to the day.
    const saved = state; state = JSON.parse(JSON.stringify(saved));
    try { applySwap(state, id, nid); return compute(); } finally { state = saved; }
  }
  /* ---------- actions ---------- */
  const A = {
    done(id) { state.statuses[id] = "done"; state.doneAt[id] = now(); state.holdUntil = null; commit(); },
    undo(id) { delete state.statuses[id]; delete state.doneAt[id]; commit(); },
    skip(id) { state.statuses[id] = "skipped"; commit(); },
    late(mins) { state.holdUntil = now() + mins; commit(); },
    clearHold() { state.holdUntil = null; commit(); },
    toggleWho(id, p) { const item = ITEMS[id]; let w = (state.who[id] || item.who).slice(); w = w.includes(p) ? w.filter(x => x !== p) : w.concat([p]); state.who[id] = w; commit(); },
    add(id, afterId) { if (!state.order.includes(id)) { const i = afterId ? state.order.indexOf(afterId) + 1 : state.order.indexOf("dinner"); state.order.splice(i, 0, id); } delete state.statuses[id]; commit(); },
    remove(id) { state.order = state.order.filter(x => x !== id); delete state.statuses[id]; commit(); },
    pin(id) { state.pinned[id] = !state.pinned[id]; commit(); },
    swap(id, nid) {
      if (!applySwap(state, id, nid)) return;
      commit();
    },
    move(id, dir) {
      // Hop over locked stops (lunch, dinner) instead of stopping at them; never past the gate or the exit.
      const o = state.order, i = o.indexOf(id); if (i < 0) return;
      let j = i + dir, k = 0;
      while (j >= 0 && j < o.length && ITEMS[o[j]].lock && ITEMS[o[j]].kind !== "travel") { j += dir; k++; }
      if (j < 0 || j >= o.length || ITEMS[o[j]].lock) return;
      o.splice(i, 1); o.splice(i + dir * Math.max(1, k), 0, id); commit(); // lands just past the locked run, or swaps with the neighbour
    },
    pref(k, v) { state.prefs[k] = v; commit(); },
    llReturn(id, v) { state.llReturn[id] = v; commit(); },
    height(id, v) { state.prefs.heights = { ...(state.prefs.heights || {}), [id]: +v }; commit(); },
    reset() { if (!confirm(SYNC_ON ? "Reset the whole day for everyone in the group?" : "Reset the day? All Done and Skip marks are cleared.")) return; state = blank(); commit(); },
    redoSetup() { if (!confirm("Redo setup? You will answer the questions again and the plan is rebuilt from your new answers.")) return; location.href = "?setup"; },
    shareOn() {
      const url = ($("#sbUrl") || {}).value, key = ($("#sbKey") || {}).value;
      const own = { url: (url || CFG.sharing && CFG.sharing.url || "").trim(), key: (key || CFG.sharing && CFG.sharing.key || "").trim(), slug: "g" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8) };
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(own.url) || own.key.length < 20) { local.shareMsg = "Paste the project URL (it ends in .supabase.co) and the publishable key from your Supabase project."; persistLocal(); render(); return; }
      try { localStorage.setItem("dd-sync", JSON.stringify(own)); localStorage.setItem("dd-force-push", "1"); } catch (e) { }
      location.reload();
    },
    shareOff() { if (!confirm("Turn sharing off on this phone? The plan stays here, and other phones keep what they have.")) return; try { localStorage.removeItem("dd-sync"); } catch (e) { } location.reload(); },
    inviteLink() {
      const o = {}; let own = {}; try { own = JSON.parse(localStorage.getItem("dd-sync") || "{}"); } catch (e) { }
      const c = CFG.sharing || {}; o.s = SB.slug; if (own.url && own.url !== c.url) o.u = own.url; if (own.key && own.key !== c.key) o.k = own.key;
      return location.origin + location.pathname + "#join=" + btoa(JSON.stringify(o));
    },
    copyInvite() { const l = A.inviteLink(); const done = () => { local.shareMsg = "Link copied. Text it to the group."; persistLocal(); render(); }; (navigator.clipboard ? navigator.clipboard.writeText(l).then(done, () => prompt("Copy this link", l)) : prompt("Copy this link", l)); },
    setNow(v) { local.nowOverride = v; persistLocal(); render(); },
    tab(t) { local.tab = t; persistLocal(); render(); },
    toggleDone() { local.showDone = !local.showDone; persistLocal(); render(); },
    openRow(id) { local.openRow = local.openRow === id ? null : id; persistLocal(); render(); },
    swapModal(id) { modal = { id, f: "best", all: false }; renderModal(); },
    swapFilter(f) { if (modal) { modal.f = f; renderModal(); } },
    swapAll() { if (modal) { modal.all = !modal.all; renderModal(); } },
    closeModal() { modal = null; renderModal(); },
    swapTo(id, nid) { modal = null; A.swap(id, nid); renderModal(); },
    findOnMap(id) { if (!D.GEO[id]) return; const had = !!map; focusId = id; local.mapSel = id; local.tab = "map"; persistLocal(); render(); window.scrollTo(0, 0); if (had) setTimeout(() => focusPin(id), 80); },
    mapSel(id) { local.mapSel = id; persistLocal(); render(); if (id && map && D.GEO[id]) { const z = Math.max(map.getZoom(), 17); const pt = map.project(D.GEO[id], z).add([0, 120]); map.flyTo(map.unproject(pt, z), z, { duration: .6 }); } },
    mapFit() { if (map) map.flyToBounds(L.latLngBounds(Object.values(D.GEO)).pad(.06), { duration: .8 }); },
    base(m) { if (map) setBase(m, true); },
    locate() { startCompass(); startLocate(true); },
    compass() { startCompass(); },
    me(p) { local.me = p || null; persistLocal(); if (local.me) { mapMsg = ""; lastPosPush = 0; startLocate(false); pushPos(); } render(); },
  };
  window.A = A;

  /* ---------- rendering ---------- */
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KIND_ICON = { travel: "🚗", meet: "🤝", ride: "🎢", show: "🎭", meal: "🍽️", break: "😴", task: "📱", treat: "🧁" };

  function avatar(p, size = 36) {
    const P = D.PEOPLE[p];
    return `<span class="av" style="--s:${size}px;background:${P.color}" title="${esc(P.name)}"><b>${esc(P.short)}</b></span>`;
  }
  const iconOf = item => item.icon || KIND_ICON[item.kind] || "✦";
  // Every stop gets a small illustrated tile (an emoji on its land's color). No photos are used anywhere.
  const artTile = (item, cls) => `<span class="${cls} art" style="--c:${D.LANDS[item.land].color}"><i>${iconOf(item)}</i></span>`;
  function whoChips(item, editable) {
    const cur = state.who[item.id] || item.who;
    return `<div class="who">${D.ALL.map(p => {
      const ok = canRide(p, item); const on = cur.includes(p) && ok;
      return `<button class="whochip ${on ? "on" : ""} ${ok ? "" : "no"}" ${editable && ok ? `onclick="A.toggleWho('${item.id}','${p}')"` : "disabled"} title="${ok ? "" : "too short for this ride"}">${avatar(p, 40)}<span>${esc(D.PEOPLE[p].name)}</span></button>`;
    }).join("")}</div>`;
  }
  const KIND = { ride: "Ride", show: "Show", meet: "Character meet", meal: "Meal", treat: "Treat", break: "Break", travel: "Travel", task: "To do" };
  const kindTag = item => KIND[item.kind] ? `<span class="tag kind k-${item.kind}">${KIND[item.kind]}</span>` : "";
  function tags(row, item) {
    const t = [];
    if (item.ll === true) t.push(`<span class="tag ll">Lightning Lane${state.llReturn[row.id] ? " " + esc(state.llReturn[row.id]) : ""}</span>`);
    else if (item.ll === "book") t.push(`<span class="tag ll">Book Lightning Lane</span>`);
    if (needsSwitch(item)) t.push(`<span class="tag">Rider Switch</span>`);
    if (item.minInches) t.push(`<span class="tag">${item.minInches}"+</span>`);
    if (item.occasion) t.push(`<span class="tag bd">${esc(item.occasion)}</span>`);
    return t.join("");
  }
  const noOneTall = item => !!item.minInches && !D.ALL.some(p => canRide(p, item));
  function swapCandidates(id) {
    const R = compute();
    const rows = R.rows.filter(r => r.id !== "exit"), idx = rows.findIndex(r => r.id === id);
    const prev = idx > 0 ? rows[idx - 1] : null, prevLand = prev ? (ITEMS[prev.id].endLand || ITEMS[prev.id].land) : ITEMS[id].land;
    const exit0 = R.rows.find(r => r.id === "exit"), end0 = exit0 ? exit0.end : 0;
    const cands = D.BONUS.concat(D.PLAN).filter(b => b.id !== id && !b.lock && (!state.order.includes(b.id) || state.statuses[b.id] === "skipped"))
      .map(b => {
        const walk = (D.WALK[prevLand] && D.WALK[prevLand][b.land]) ?? 10;
        const gated = noOneTall(b);
        let effect = "", cls = "none", delta2 = 0;
        if (gated) { effect = "No one is tall enough"; }
        else {
          const R2 = previewSwap(id, b.id); const exit = R2.rows.find(r => r.id === "exit");
          const newlyDropped = R2.dropped.filter(x => !R.dropped.includes(x)).map(x => ITEMS[x].title);
          const inPlan = R2.rows.some(r => r.id === b.id);
          const delta = exit && exit0 ? Math.round(exit.end - end0) : 0;
          if (!inPlan) { effect = R2.dropped.includes(b.id) ? "Day too full for it" : b.times ? "No showtime left" : "Closed by then"; cls = "none"; }
          else if (newlyDropped.length) { effect = `Bumps ${newlyDropped[0]}${newlyDropped.length > 1 ? ` +${newlyDropped.length - 1}` : ""}`; cls = "drop"; }
          else if (delta > 2) { effect = `Ends ${delta} min later`; cls = "late"; delta2 = delta; }
          else if (delta < -2) { effect = `Ends ${-delta} min earlier`; cls = "fit"; }
          else { effect = "Fits"; cls = "fit"; }
        }
        return { b, walk, gated, effect, cls, later: delta2 };
      })
      .sort((x, y) => x.walk - y.walk || effPriority(y.b) - effPriority(x.b));
    return { cands, prev: prev ? ITEMS[prev.id] : null };
  }
  const swapOptions = id => swapCandidates(id).cands.map(({ b, walk, gated, effect }) => `<option value="${b.id}" ${gated ? "disabled" : ""}>${esc(b.title)} · ${walk} min walk · ${b.dur} min · ${effect}</option>`).join("");
  let modal = null;
  function renderModal() {
    let host = $("#modal"); if (!host) { host = document.createElement("div"); host.id = "modal"; document.body.appendChild(host); }
    if (!modal) { host.innerHTML = ""; host.hidden = true; document.body.classList.remove("modal-open"); return; }
    const item = ITEMS[modal.id]; const { cands, prev } = swapCandidates(modal.id);
    const f = modal.f || "best";
    const passes = c => {
      if (modal.all && !D.ALL.every(p => canRide(p, c.b))) return false;
      if (f === "all") return true;
      if (f === "best") return !c.gated && (c.cls === "fit" || (c.cls === "late" && c.later <= 15));
      if (f === "food") return c.b.kind === "meal" || c.b.kind === "treat";
      return c.b.kind === f;
    };
    const shown = cands.filter(passes);
    const key = modal.id + "|" + f + "|" + modal.all;
    const oldList = host.querySelector(".mlist"); const top = oldList && host.dataset.key === key ? oldList.scrollTop : 0;
    host.hidden = false; document.body.classList.add("modal-open"); host.dataset.key = key;
    host.innerHTML = `<div class="mbg" onclick="A.closeModal()"></div>
      <div class="msheet" role="dialog" aria-label="Swap ${esc(item.title)}">
        <div class="mhead"><div><p class="eyebrow">Swap this stop</p><h2>${esc(item.title)}</h2><p class="sub">Closest first${prev ? `, walking from ${esc(shortTitle(prev.title))}` : ""}. The chip says what happens to the rest of the day.</p></div><button class="x" onclick="A.closeModal()" aria-label="Close">×</button></div>
        <div class="mfilters">${SWAP_FILTERS.map(([k, l]) => `<button class="fchip ${f === k ? "on" : ""}" onclick="A.swapFilter('${k}')">${l}</button>`).join("")}<button class="fchip ${modal.all ? "on" : ""}" onclick="A.swapAll()">Everyone can ride</button></div>
        <div class="mlist">${shown.length ? shown.map(({ b, walk, gated, effect, cls }) => { return `<button class="cand ${cls}" ${gated ? "disabled" : ""} onclick="A.swapTo('${modal.id}','${b.id}')">
            ${artTile(b, "thumb")}
            <span class="ctext"><span class="ctitle">${esc(b.title)}</span><span class="cmeta">${KIND[b.kind] || ""} · ${b.dur} min · ${walk ? `${walk} min walk` : "same land"}${b.minInches ? ` · ${b.minInches}"+` : ""}</span></span>
            <span class="chip ${cls}">${esc(effect)}</span></button>`; }).join("") : `<p class="mempty">${f === "best" ? "Nothing fits cleanly right now. Tap All to see every option." : "Nothing in this group. Tap All."}</p>`}</div>
      </div>`;
    const newList = host.querySelector(".mlist"); if (newList && top) newList.scrollTop = top;
  }
  const SWAP_FILTERS = [["best", "Best"], ["all", "All"], ["ride", "Rides"], ["show", "Shows"], ["meet", "Characters"], ["break", "Rest"]];


  function actions(row, item) {
    return `<div class="actions">
      ${row.done ? `<button class="btn" onclick="A.undo('${row.id}')">Undo</button>` :
        `<button class="btn primary" onclick="A.done('${row.id}')">Done</button><button class="btn" onclick="A.skip('${row.id}')">Skip</button>`}
      ${item.ll === true && !row.done ? `<button class="btn" onclick="var v=prompt('Lightning Lane return window, e.g. 2:15-3:15');if(v!=null)A.llReturn('${row.id}',v)">Return time</button>` : ""}
      ${D.GEO[row.id] ? `<button class="btn quiet" onclick="A.findOnMap('${row.id}')">Map</button>` : ""}<a class="btn quiet" href="${item.link}" target="_blank" rel="noopener">Disney page</a>
      ${!item.lock && !row.done ? `<button class="btn quiet sm" onclick="A.move('${row.id}',-1)">Earlier</button><button class="btn quiet sm" onclick="A.move('${row.id}',1)">Later</button>${state.pinned[row.id] ? `<button class="btn quiet sm" onclick="A.pin('${row.id}')" title="Tap to let the planner drop this again">Kept ✓</button>` : ""}<button class="btn quiet sm" onclick="A.swapModal('${row.id}')">Swap</button>` : ""}
      ${!D.PLAN.find(p => p.id === row.id) ? `<button class="btn quiet sm" onclick="A.remove('${row.id}')">Remove</button>` : ""}
    </div>`;
  }
  function hero(row) {
    const item = ITEMS[row.id]; const land = D.LANDS[item.land];
    return `<article class="hero">
      <div class="photo art" style="--c:${land.color}"><i>${iconOf(item)}</i></div>
      <p class="when">Now · ${fmt(row.start)} to ${fmt(row.end)}</p>
      <h2>${esc(item.title)}</h2>
      <p class="sub">${kindTag(item)}<span>${esc(land.name)} · ${row.dur} min${row.walk ? ` · ${row.walk} min walk` : ""}</span>${tags(row, item)}</p>
      <p class="note">${esc(item.note || "")}</p>
      ${whoChips(item, true)}
      ${actions(row, item)}
    </article>`;
  }
  function rowHtml(row, opts = {}) {
    const item = ITEMS[row.id]; const land = D.LANDS[item.land];
    return `<div class="row ${row.done ? "done" : ""} ${opts.current ? "current" : ""}">
      <span class="t">${fmt(row.start)}${row.walk ? `<small>${row.walk} min walk</small>` : ""}</span>
      ${artTile(item, "thumb")}
      <div><h3>${esc(item.title)}</h3><p class="sub">${kindTag(item)}<span>${esc(land.name)} · ${row.dur} min</span>${tags(row, item)}</p></div>
    </div>`;
  }
  function detail(row) {
    const item = ITEMS[row.id];
    return `<div class="detail"><p class="note">${esc(item.note || "")}</p>${whoChips(item, !row.done)}${actions(row, item)}</div>`;
  }
  const poolRow = (id, sub, btn) => `<div class="pool"><span>${esc(ITEMS[id].title)}${sub ? `<small>${sub}</small>` : ""}</span>${btn || ""}</div>`;

  function renderNow(R) {
    const nowM = now();
    const pending = R.rows.filter(r => !r.done);
    const cur = pending[0]; const next = pending.slice(1, 5);
    const nextLL = D.LL_ORDER.find(id => state.order.includes(id) && state.statuses[id] !== "done" && state.statuses[id] !== "skipped");
    const hold = state.holdUntil && state.holdUntil > nowM ? `<div class="notice late">Running late. Nothing starts before ${fmt(state.holdUntil)}.<button onclick="A.clearHold()">Back on track</button></div>` : "";
    const preview = !isTheDay() && local.nowOverride == null ? `<div class="notice">Preview of the plan. Live times start on ${esc(dateLabel())}.</div>` : local.nowOverride != null ? `<div class="notice">Pretend time: ${fmt(local.nowOverride)}<button onclick="A.setNow(null)">Use real time</button></div>` : "";
    return `${preview}${hold}
      ${cur ? hero(cur) : `<div class="notice">All done. Drive safe.</div>`}
      <div class="late"><span>Running late?</span><button class="btn" onclick="A.late(15)">+15 min</button><button class="btn" onclick="A.late(30)">+30</button><button class="btn" onclick="A.late(60)">+60</button></div>
      ${D.MULTI && nextLL ? `<div class="notice ll">Lightning Lane: when you scan into the current one (or two hours after booking it), book whichever of these has the soonest window: <b>${D.LL_ORDER.filter(id => state.order.includes(id) && state.statuses[id] !== "done" && state.statuses[id] !== "skipped" && !state.llReturn[id]).map(id => esc(shortTitle(ITEMS[id].title))).join(", ")}</b>. Then type the window on that ride with Return time.</div>` : ""}
      ${next.length ? `<h2 class="sec">Then</h2><div class="list">${next.map(r => `<div class="rowwrap" onclick="A.findOnMap('${r.id}')">${rowHtml(r)}</div>`).join("")}</div>` : ""}
      ${R.dropped.length ? `<h2 class="sec">Dropped to fit the day</h2>${R.dropped.map(id => poolRow(id, "", `<button class="btn sm" onclick="A.pin('${id}')">Keep it</button>`)).join("")}` : ""}
      ${R.missed.length ? `<h2 class="sec">No time slot left</h2>${R.missed.map(id => poolRow(id)).join("")}` : ""}`;
  }

  function renderDay(R) {
    const exit = R.rows.find(r => r.id === "exit");
    const pending = R.rows.filter(r => !r.done); const curId = pending[0] && pending[0].id;
    const skipped = Object.keys(state.statuses).filter(id => state.statuses[id] === "skipped");
    // Finished stops fold away behind a toggle so the day opens on what is left.
    const done = R.rows.filter(r => r.done).sort((a, b) => a.start - b.start);
    const dayRow = r => `<div class="rowwrap ${local.openRow === r.id ? "open" : ""}" onclick="if(event.target.closest('.dx'))return;A.openRow('${r.id}')">${rowHtml(r, { current: r.id === curId })}<div class="dx" ${local.openRow === r.id ? "" : "hidden"}>${detail(r)}</div></div>`;
    return `<p class="hint" style="margin:4px 0 12px">${R.rows.length} stops · out of the park ${exit ? fmt(exit.end - 30) : "—"} · home by ${exit ? fmt(exit.end + 60) : "—"}. Tap a stop to open it.</p>
      ${done.length ? `<button class="donetoggle" onclick="A.toggleDone()" aria-expanded="${local.showDone ? "true" : "false"}"><span>${done.length} done</span><b>${local.showDone ? "Hide" : "Show"}</b></button>${local.showDone ? `<div class="list donelist">${done.map(dayRow).join("")}</div>` : ""}` : ""}
      <div class="list">${pending.map(dayRow).join("")}</div>
      ${R.dropped.length || R.missed.length ? `<h2 class="sec">Not scheduled</h2>${R.dropped.map(id => poolRow(id, "dropped to fit the day", `<button class="btn sm" onclick="A.pin('${id}')">Keep it</button>`)).join("")}${R.missed.map(id => poolRow(id, "no time slot left")).join("")}` : ""}
      ${skipped.length ? `<h2 class="sec">Skipped</h2>${skipped.map(id => poolRow(id, "", `<button class="btn sm" onclick="A.undo('${id}')">Put back</button>`)).join("")}` : ""}`;
  }

  function renderFamily() {
    const kids = D.KIDS;
    const occ = D.OCC;
    return `<div class="family">${D.ALL.map(p => { const P = D.PEOPLE[p]; return `<div class="person">${avatar(p, 72)}<h3>${esc(P.name)}</h3><small>${P.role === "kid" ? inches(p) + " in" : "adult"}</small></div>`; }).join("")}</div>
      <h2 class="sec">Who can ride</h2>
      <table class="rides"><tr><th>Ride</th><th>Min</th>${kids.map(k => `<th>${esc(D.PEOPLE[k].name.slice(0, 7))}</th>`).join("")}</tr>
      ${D.PLAN.concat(D.BONUS).filter(i => i.kind === "ride").map(i => `<tr><td>${esc(i.title)}</td><td>${i.minInches ? i.minInches + '"' : "any"}</td>${kids.map(k => `<td class="${canRide(k, i) ? "ok" : "no"}">${canRide(k, i) ? "Yes" : "No"}</td>`).join("")}</tr>`).join("")}</table>
      ${kids.length ? "" : `<p class="hint">Nobody in this group has a height limit.</p>`}
      <h2 class="sec">Rider Switch</h2><p class="hint">The whole group walks up. One adult waits with anyone who is too short, the others ride, then the waiting adult rides straight away without queueing again. Ask at the ride entrance.</p>
      ${occ ? `<h2 class="sec">${esc(occ.tag)}</h2><p class="hint">Get a free celebration button at City Hall first thing, plan a treat in the afternoon, and tell cast members whenever you can.${occ.label && occ.kind === "other" ? " " + esc(occ.label) + "." : ""}</p>` : ""}`;
  }

  function renderSettings() {
    const p = state.prefs;
    const sel = (k, opts) => `<select onchange="A.pref('${k}',this.value)">${opts.map(([v, l]) => `<option value="${v}" ${p[k] == v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const tog = (k, label, hint) => `<label class="tog"><div><span>${label}</span><small>${hint}</small></div><input type="checkbox" ${p[k] ? "checked" : ""} onchange="A.pref('${k}',this.checked)"></label>`;
    const dep = []; for (let m = D.T(14, 0); m <= D.T(22, 30); m += 30) dep.push([m, fmt(m)]);
    const pool = D.BONUS.filter(b => !state.order.includes(b.id));
    const times = []; for (let m = D.T(7, 0); m <= D.T(21, 0); m += 30) times.push([m, fmt(m)]);
    const hasNap = D.PLAN.some(x => x.id === "nap");
    const hts = []; for (let h = 28; h <= 66; h++) hts.push(h);
    const heights = D.KIDS.map(k => `<div class="pref"><span>${esc(D.PEOPLE[k].name)}<small class="sm">${D.PEOPLE[k].estimated && !(p.heights && p.heights[k]) ? "estimated from age, measure before you go" : "inches"}</small></span><select onchange="A.height('${k}',this.value)">${hts.map(h => `<option value="${h}" ${inches(k) == h ? "selected" : ""}>${h} in</option>`).join("")}</select></div>`).join("");
    const cfgShare = CFG.sharing && CFG.sharing.url && CFG.sharing.key;
    const share = SYNC_ON
      ? `<p class="hint">Sharing is on. Everyone who opens the invite link sees the same plan, and adults can share their spot on the Map tab. Status: <b>${esc(local.syncStatus)}</b>.</p>
         <div class="actions"><button class="btn primary" onclick="A.copyInvite()">Copy invite link</button><button class="btn" onclick="A.shareOff()">Turn sharing off</button></div>`
      : `<p class="hint">Optional. Keeps everyone's phone on one live plan and shows family locations on the map. It uses your own free Supabase project, and the README walks through the setup in about five minutes.</p>
         ${cfgShare ? "" : `<div class="field"><label>Project URL<input id="sbUrl" placeholder="https://abcdxyz.supabase.co" autocapitalize="off" autocorrect="off" spellcheck="false"></label><label>Publishable key<input id="sbKey" placeholder="sb_publishable_..." autocapitalize="off" autocorrect="off" spellcheck="false"></label></div>`}
         <div class="actions"><button class="btn" onclick="A.shareOn()">Turn on sharing</button></div>`;
    return `<h2 class="sec">The day</h2>
      <div class="pref"><span>Leave the park</span>${sel("departure", dep)}</div>
      <div class="pref"><span>Lean toward</span>${sel("lean", [["balanced", "Balanced"], ["characters", "More characters"], ["rides", "More rides"], ["rest", "More rest"]])}</div>
      ${hasNap ? tog("napOn", "Nap or quiet break", "A rest stop in the middle of the day") : ""}
      ${D.KIDS.length ? `<h2 class="sec">Heights</h2>${heights}<p class="hint">Rides with a height limit use these numbers. Update them after you measure.</p>` : ""}
      <h2 class="sec">Add a stop</h2>
      ${pool.map(b => `<div class="pool"><span>${esc(b.title)}<small>${b.minInches ? b.minInches + '" · ' : ""}${b.dur} min</small></span><button class="btn sm" onclick="A.add('${b.id}')" ${noOneTall(b) ? "disabled title='nobody is tall enough'" : ""}>Add</button></div>`).join("") || "<p class='hint'>Everything is in the plan.</p>"}
      <h2 class="sec">Share with your group</h2>
      ${share}
      ${local.shareMsg ? `<p class="hint">${esc(local.shareMsg)}</p>` : ""}
      <h2 class="sec">Setup</h2>
      <div class="actions"><button class="btn" onclick="A.redoSetup()">Redo setup</button><button class="btn" onclick="A.reset()">Reset the day</button></div>
      <p class="hint">Redo setup asks the questions again and rebuilds the plan. Reset the day keeps the plan and clears every Done and Skip.</p>
      <h2 class="sec">Testing</h2>
      <div class="pref"><span>Pretend it is</span><select onchange="A.setNow(this.value===''?null:+this.value)"><option value="">real time</option>${times.map(([v, l]) => `<option value="${v}" ${local.nowOverride == v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <p class="hint">Pretend time only changes this phone.</p>
      <p class="hint">Heights, hours and Lightning Lane rules were checked on disneyland.com in October 2026 and change often. Showtimes and character times are only in the Disneyland app, so check there in the morning. This is a fan-made planner and is not affiliated with Disney.</p>`;
  }

  function renderSync() { const el = $("#sync"); if (el) el.textContent = local.syncStatus; }

  /* ---------- map ---------- */
  let map = null, pinLayer, routeLayer, labelLayer, meLayer, famLayer, pins = {}, locOn = false, locFirst = false, locFly = false, focusId = null, heading = null, shown = null, compassOn = false, compassListening = false, compassMsg = "", mapMsg = "", myPos = null, lastPosPush = 0, famPos = {};
  let parkLayer, streetLayer, attrib, baseMode = null, baseSwitching = 0, parkOk = 0, parkErr = 0;
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  /*
    Two map styles:
    - street: OpenStreetMap, free, with the walkway data this app routes on. Always works.
    - park: Disney's own illustrated park map. These tiles are fetched from Disney's servers while the app runs and are
      never stored in this repo. If Disney stops serving them, the app falls back to street. Set disneyMapTiles to false in config.js to turn them off.
  */
  const PARK_URL = CFG.parkMapUrl || "https://cdn6.parksmedia.wdprapps.disney.com/media/maps/prod/disneyland/671203034/{z}/{x}/{y}.jpg";
  const BASES = {
    park: { url: PARK_URL, opts: { detectRetina: true, maxNativeZoom: L.Browser.retina ? 19 : 20, maxZoom: 21, minZoom: 14, errorTileUrl: BLANK, pane: "park", keepBuffer: 3 }, credit: "Map art: Disney (loaded from Disney)" },
    street: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", opts: { maxNativeZoom: 19, maxZoom: 21, pane: "street", keepBuffer: 2, attribution: "" }, credit: "&copy; OpenStreetMap contributors" },
  };
  /* walkway routing: window.PATHS = { n: [[lat,lon],...], e: [[i,j],...] } from paths.js (OpenStreetMap footways) */
  let G = null; const legCache = {};
  function graph() {
    if (G || !window.PATHS) return G;
    const n = PATHS.n, adj = n.map(() => []);
    const m = (a, b) => { const x = (n[b][1] - n[a][1]) * Math.cos(n[a][0] * Math.PI / 180) * 111320, y = (n[b][0] - n[a][0]) * 110540; return Math.hypot(x, y); };
    PATHS.e.forEach(([a, b]) => { const w = m(a, b); adj[a].push([b, w]); adj[b].push([a, w]); });
    return (G = { n, adj });
  }
  function snap(ll) {
    const { n } = G; let best = -1, bd = Infinity; const cl = Math.cos(ll[0] * Math.PI / 180) * 111320;
    for (let i = 0; i < n.length; i++) { const x = (n[i][1] - ll[1]) * cl, y = (n[i][0] - ll[0]) * 110540, d = x * x + y * y; if (d < bd) { bd = d; best = i; } }
    return Math.sqrt(bd) <= 70 ? best : -1;
  }
  function dijkstra(src, dst) {
    const { n, adj } = G; const dist = new Float64Array(n.length).fill(Infinity), prev = new Int32Array(n.length).fill(-1);
    const heap = [[0, src]]; dist[src] = 0;
    const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let mn = i; if (l < heap.length && heap[l][0] < heap[mn][0]) mn = l; if (r < heap.length && heap[r][0] < heap[mn][0]) mn = r; if (mn === i) break; [heap[mn], heap[i]] = [heap[i], heap[mn]]; i = mn; } } return top; };
    while (heap.length) {
      const [d, u] = pop(); if (u === dst) break; if (d > dist[u]) continue;
      for (const [v, w] of adj[u]) { const nd = d + w; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); } }
    }
    if (dist[dst] === Infinity) return null;
    const out = []; for (let v = dst; v !== -1; v = prev[v]) out.push(n[v]); return out.reverse();
  }
  function legPath(aId, bId) {
    const key = aId + ">" + bId; if (legCache[key]) return legCache[key];
    const a = D.GEO[aId], b = D.GEO[bId]; let pts = [a, b];
    if (graph()) { const sa = snap(a), sb = snap(b); if (sa >= 0 && sb >= 0) { const r = sa === sb ? [G.n[sa]] : dijkstra(sa, sb); if (r) pts = [a].concat(r, [b]); } }
    return (legCache[key] = pts);
  }
  function shortTitle(t) { let x = String(t).split(/[:(]/)[0].replace(/^Book next Lightning Lane/i, "Lightning Lane").trim(); if (x.length > 30) x = x.slice(0, 29).replace(/\s+\S*$/, "") + "…"; return x; }
  function pinHtml(item, n, st, i) {
    const badge = st === "done" ? "✓" : n != null ? n : "+";
    const label = st === "ghost" ? "" : `<small>${esc(shortTitle(item.title))}</small>`;
    return `<div class="pr" style="--i:${i}"><span class="shd"></span><div class="pin ${st}"><span class="ring"></span><span class="body"></span><span class="gloss"></span><span class="ph" style="background:${D.LANDS[item.land].color}"><i>${iconOf(item)}</i></span><b>${badge}</b>${label}</div></div>`;
  }
  function setBase(mode, animate) {
    if (!map || !BASES[mode] || (mode === baseMode && animate)) return;
    const prev = baseMode; baseMode = mode; local.base = mode; persistLocal();
    document.body.classList.toggle("park", true);
    document.querySelectorAll(".seg button").forEach(b => b.classList.toggle("on", b.dataset.base === mode));
    const inc = mode === "park" ? parkLayer : streetLayer, out = mode === "park" ? streetLayer : parkLayer;
    const incPane = map.getPane(mode === "park" ? "park" : "street"), outPane = map.getPane(mode === "park" ? "street" : "park");
    incPane.style.zIndex = 210; outPane.style.zIndex = 200;
    if (mode === "park") map.removeLayer(labelLayer); else if (!map.hasLayer(labelLayer)) labelLayer.addTo(map); // Disney's map has land names built in; the street map needs ours
    Object.values(BASES).forEach(b => attrib.removeAttribution(b.credit)); attrib.addAttribution(BASES[mode].credit);
    const token = ++baseSwitching;
    if (!animate || !prev) { incPane.style.opacity = 1; if (!map.hasLayer(inc)) inc.addTo(map); if (map.hasLayer(out)) map.removeLayer(out); outPane.style.opacity = 0; }
    else {
      incPane.style.opacity = 0; if (!map.hasLayer(inc)) inc.addTo(map);
      let fired = false;
      const go = () => { if (fired || token !== baseSwitching) return; fired = true; requestAnimationFrame(() => { incPane.style.opacity = 1; }); setTimeout(() => { if (token !== baseSwitching) return; if (map.hasLayer(out)) map.removeLayer(out); outPane.style.opacity = 0; }, 800); };
      inc.once("load", go); setTimeout(go, 1500);
    }
    if (animate) render();
  }
  function zOf(st, sel) { return st === "cur" ? 1000 : sel ? 900 : st === "ghost" ? 0 : 100; }
  function upsertPin(id, item, n, st, i) {
    const sel = local.mapSel === id;
    const sig = [n, st, sel].join("|");
    const ghost = st === "ghost";
    const icon = () => L.divIcon({ className: "pinwrap" + (sel ? " sel" : "") + (ghost ? " ghost" : ""), html: pinHtml(item, n, st, i), iconSize: ghost ? [30, 30] : [46, 52], iconAnchor: ghost ? [15, 15] : [23, 50] });
    const p = pins[id];
    if (!p) {
      const m = L.marker(D.GEO[id], { icon: icon(), zIndexOffset: zOf(st, sel), keyboard: false });
      m.on("click", e => { L.DomEvent.stop(e); A.mapSel(id); });
      m.addTo(pinLayer); pins[id] = { m, sig };
    } else if (p.sig !== sig) { p.m.setIcon(icon()); p.m.setZIndexOffset(zOf(st, sel)); p.sig = sig; }
  }
  function startLocate(fly) {
    // The map opens on the whole park. It only moves to you when you press the location button.
    if (fly) locFly = true;
    if (!map || !navigator.geolocation) { mapMsg = "Location is not available on this phone."; render(); return; }
    if (SYNC_ON && !local.me) mapMsg = "Pick your name below so the group can see your spot.";
    if (locOn) { if (myPos) { locFly = false; map.flyTo([myPos.lat, myPos.lon], Math.max(map.getZoom(), 17), { duration: .6 }); } render(); return; } locOn = true; // already on: the button recentres on you
    map.on("locationfound", e => {
      myPos = { lat: e.latlng.lat, lon: e.latlng.lng, acc: e.accuracy };
      meLayer.clearLayers();
      L.circle(e.latlng, { radius: Math.min(e.accuracy, 60), color: "#5aa9ff", weight: 1, opacity: .35, fillOpacity: .08, interactive: false }).addTo(meLayer);
      if (heading == null && e.heading != null && !isNaN(e.heading) && e.speed > 0.7) setHeading(e.heading, true); // walking: GPS direction until the compass is on
      L.marker(e.latlng, { icon: L.divIcon({ className: "me" + (heading != null ? " hd" : ""), html: `<b style="transform:rotate(${shown || 0}deg)"></b><i></i>`, iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1200 }).addTo(meLayer);
      if (!locFirst || locFly) { locFirst = true; if (local.me || !SYNC_ON) mapMsg = ""; if (locFly) { locFly = false; map.flyTo(e.latlng, Math.max(map.getZoom(), 17), { duration: .8 }); } render(); }
      pushPos();
    });
    map.on("locationerror", () => { mapMsg = "Location is blocked. Allow it for this site in your phone settings."; locOn = false; render(); });
    map.locate({ watch: true, enableHighAccuracy: true, setView: false, maximumAge: 5000 });
    const b = $("#locbtn"); if (b) b.classList.add("on");
  }
  // Which way you are facing: the phone compass. iPhones ask permission, which needs a tap, so it starts from the location button.
  function setHeading(h, fromGps) {
    if (h == null || isNaN(h)) return;
    if (fromGps && compassOn) return;
    h = (h % 360 + 360) % 360;
    // Turn the short way round (350 to 10 is +20, not -340) so the cone never spins.
    shown = shown == null ? h : shown + ((h - shown % 360 + 540) % 360 - 180);
    heading = h;
    document.querySelectorAll(".leaflet-marker-icon.me").forEach(el => { el.classList.add("hd"); const b = el.querySelector("b"); if (b) b.style.transform = `rotate(${shown}deg)`; });
  }
  function onOrient(e) {
    let h = e.webkitCompassHeading;
    if (h == null && e.absolute && e.alpha != null) h = 360 - e.alpha;
    if (h == null || h < 0) return;
    const turn = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    setHeading(h + turn);
    if (!compassOn) { compassOn = true; compassMsg = ""; if (map && local.tab === "map") render(); }
  }
  // iPhones only send compass readings after the person taps and allows motion access.
  function startCompass() {
    if (compassOn) return;
    if (!window.DeviceOrientationEvent) { compassMsg = "This phone does not share its compass with web pages."; render(); return; }
    if (!compassListening) { compassListening = true; window.addEventListener("deviceorientationabsolute", onOrient); window.addEventListener("deviceorientation", onOrient); }
    const wait = () => setTimeout(() => { if (!compassOn) { compassMsg = "No compass reading yet. Move the phone in a figure eight, then tap the button again."; render(); } }, 3000);
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then(st => {
        if (st === "granted") wait();
        else { compassMsg = "Direction is blocked. Close Safari completely, open this page again, tap the button and choose Allow."; render(); }
      }).catch(() => { compassMsg = "Tap the button again and choose Allow."; render(); });
    } else wait();
  }
  function focusPin(id) {
    if (!map || !D.GEO[id]) return;
    map.invalidateSize();
    const z = Math.max(map.getZoom(), 17.5); const pt = map.project(D.GEO[id], z).add([0, 120]);
    map.flyTo(map.unproject(pt, z), z, { duration: .7 });
  }
  function relocate() {
    // iPhones pause the page when it is locked or in the background, which stops the location watch. Restart it and post a fresh fix.
    if (!map || !locOn) return;
    try { map.stopLocate(); } catch (e) { }
    lastPosPush = 0;
    map.locate({ watch: true, enableHighAccuracy: true, setView: false, maximumAge: 0 });
  }
  async function pushPos() {
    if (!SYNC_ON || !myPos || !local.me || Date.now() - lastPosPush < 10000) return;
    lastPosPush = Date.now();
    try {
      await fetch(`${SB.url}/rest/v1/disney_pos`, { method: "POST", headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ slug: SB.slug, person: local.me, lat: myPos.lat, lon: myPos.lon, acc: myPos.acc, updated_at: new Date().toISOString() }]) });
    } catch (e) { }
  }
  async function pullPos() {
    if (!SYNC_ON) return;
    try {
      const r = await fetch(`${SB.url}/rest/v1/disney_pos?slug=eq.${SB.slug}&select=person,lat,lon,acc,updated_at`, { headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}` } });
      if (!r.ok) return;
      const rows = await r.json(); famPos = {};
      rows.forEach(x => { famPos[x.person] = x; });
      if (map && local.tab === "map") drawFamily();
    } catch (e) { }
  }
  function drawFamily() {
    famLayer.clearLayers();
    const cutoff = Date.now() - 3 * 60 * 60 * 1000; // keep the last known spot for 3 hours
    Object.keys(famPos).forEach(p => {
      const x = famPos[p]; if (!D.PEOPLE[p] || p === local.me || new Date(x.updated_at).getTime() < cutoff) return;
      const ageMin = Math.round((Date.now() - new Date(x.updated_at).getTime()) / 60000);
      const stale = ageMin >= 10;
      const label = ageMin >= 2 ? `${esc(D.PEOPLE[p].name)} · ${ageMin} min` : esc(D.PEOPLE[p].name);
      const m = L.marker([x.lat, x.lon], { icon: L.divIcon({ className: "fam" + (stale ? " stale" : ""), html: `${avatar(p, 38)}<small>${label}</small>`, iconSize: [38, 38], iconAnchor: [19, 19] }), interactive: false, zIndexOffset: 1100 });
      m.addTo(famLayer);
    });
  }
  function sheetRow(R, row, item, curId) {
    const land = D.LANDS[item.land];
    return `<div class="sh"><button class="x" onclick="A.mapSel(null)" aria-label="Close">×</button>
      ${artTile(item, "thumb")}
      <div><p class="when">${row.done ? "Done" : row.id === curId ? "Now" : fmt(row.start)}${row.walk ? ` · ${row.walk} min walk` : ""}</p><h3>${esc(item.title)}</h3><p class="sub">${kindTag(item)}<span>${esc(land.name)} · ${row.dur} min</span>${tags(row, item)}</p></div></div>
      <p class="note">${esc(item.note || "")}</p>
      ${whoChips(item, !row.done)}
      ${actions(row, item)}`;
  }
  function sheetGhost(R, item) {
    const land = D.LANDS[item.land];
    const gated = noOneTall(item);
    const opts = R.rows.filter(r => !r.done && !ITEMS[r.id].lock && r.id !== item.id).map(r => `<option value="${r.id}">${fmt(r.start)} · ${esc(ITEMS[r.id].title)}</option>`).join("");
    return `<div class="sh"><button class="x" onclick="A.mapSel(null)" aria-label="Close">×</button>
      ${artTile(item, "thumb")}
      <div><p class="when">Not in the plan</p><h3>${esc(item.title)}</h3><p class="sub">${kindTag(item)}<span>${esc(land.name)} · ${item.dur} min</span>${item.minInches ? `<span class="tag">${item.minInches}"+</span>` : ""}</p></div></div>
      <p class="note">${esc(item.note || "")}${gated ? " Nobody in the group is tall enough for this one." : ""}</p>
      <div class="actions"><button class="btn primary" onclick="A.add('${item.id}')" ${gated ? "disabled" : ""}>Add to the day</button>
      <select class="swap" ${gated ? "disabled" : ""} onchange="if(this.value)A.swap(this.value,'${item.id}')"><option value="">Swap it in for…</option>${opts}</select></div>`;
  }
  function renderMap(R) {
    if (!map) {
      map = L.map("map", { zoomControl: false, attributionControl: false, maxZoom: 20, minZoom: 14, zoomSnap: .25, wheelPxPerZoomLevel: 90 });
      map.createPane("park"); map.createPane("street");
      parkLayer = L.tileLayer(BASES.park.url, BASES.park.opts); streetLayer = L.tileLayer(BASES.street.url, BASES.street.opts);
      // If Disney's tiles never load (blocked, moved, offline), switch to the free street map and say so.
      parkLayer.on("tileload", () => { parkOk++; }); 
      parkLayer.on("tileerror", () => { parkErr++; if (baseMode === "park" && parkOk === 0 && parkErr >= 4) { mapMsg = "Disney's park map is not available right now, so this is the free street map."; setBase("street", true); } });
      attrib = L.control.attribution({ position: "topleft", prefix: false }).addTo(map);
      routeLayer = L.layerGroup().addTo(map); labelLayer = L.layerGroup().addTo(map); pinLayer = L.layerGroup().addTo(map); famLayer = L.layerGroup().addTo(map); meLayer = L.layerGroup().addTo(map);
      const zl = () => map.getContainer().classList.toggle("zl", map.getZoom() >= 17.4);
      map.on("zoomend", zl); zl();
      setBase(BASES[local.base] ? local.base : "park", false);
      Object.keys(D.LAND_GEO).forEach(k => L.marker(D.LAND_GEO[k], { icon: L.divIcon({ className: "landlbl", html: `<span>${esc(D.LANDS[k].name)}</span>`, iconSize: [0, 0] }), interactive: false, keyboard: false, zIndexOffset: -2000 }).addTo(labelLayer));
      map.on("click", () => { if (local.mapSel) A.mapSel(null); });
      const B = L.latLngBounds(Object.values(D.GEO));
      map.setView(B.getCenter(), 14);
      if (focusId) { const id = focusId; setTimeout(() => focusPin(id), 120); }
      else setTimeout(() => map.flyToBounds(B.pad(.06), { duration: 2.2, easeLinearity: .2 }), 400);
      if (local.me && !locOn) setTimeout(() => startLocate(false), 2500);
    }
    setTimeout(() => map.invalidateSize(), 0);
    const rows = R.rows.filter(r => D.GEO[r.id]);
    const pending = R.rows.filter(r => !r.done); const curId = pending[0] && pending[0].id;
    const seen = {};
    rows.forEach((r, i) => { upsertPin(r.id, ITEMS[r.id], i + 1, r.done ? "done" : r.id === curId ? "cur" : "todo", i); seen[r.id] = 1; });
    D.BONUS.concat(D.PLAN).filter(b => D.GEO[b.id] && !seen[b.id] && !b.lock && b.id !== "nap").forEach((b, i) => { upsertPin(b.id, ITEMS[b.id], null, "ghost", rows.length + i); seen[b.id] = 1; });
    Object.keys(pins).forEach(id => { if (!seen[id]) { pinLayer.removeLayer(pins[id].m); delete pins[id]; } });
    routeLayer.clearLayers();
    const park = true; // both map styles are light, so the route uses the blue and white look
    const C = { done: "#8a879f", caseC: "#ffffff", line: "#0a66d6", far: "#4f86d8" };
    const walkRows = rows.filter(r => !(ITEMS[r.id].kind === "task" && /^ll\d/.test(r.id)));
    const legs = []; for (let i = 1; i < walkRows.length; i++) legs.push({ a: walkRows[i - 1], b: walkRows[i] });
    // The moving dots always lead to the first stop not marked Done. They move on only when that stop is tapped Done.
    const firstTodo = legs.findIndex(l => !l.b.done);
    const flowIdx = Math.max(0, firstTodo);
    legs.forEach((l, i) => {
      const pts = legPath(l.a.id, l.b.id); const k = Math.max(0, i - flowIdx);
      if (l.b.done) L.polyline(pts, { color: C.done, weight: 2.5, opacity: park ? .55 : .45, dashArray: "1 8", lineCap: "round", interactive: false }).addTo(routeLayer);
      else if (k <= 2) {
        L.polyline(pts, { color: C.caseC, weight: 9, opacity: park ? .85 : .35, lineCap: "round", lineJoin: "round", className: "routecase", interactive: false }).addTo(routeLayer);
        const flow = i === flowIdx;
        L.polyline(pts, { color: C.line, weight: 3.5, opacity: 1, dashArray: flow ? "2 9" : null, lineCap: "round", lineJoin: "round", className: flow ? "routeflow" : "", interactive: false }).addTo(routeLayer);
        if (!flow) L.polyline(pts, { color: "#ffffff", weight: 1, opacity: .35, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routeLayer);
      } else L.polyline(pts, { color: C.far, weight: 2, opacity: park ? .45 : .5, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routeLayer);
    });
    drawFamily();
    const sel = local.mapSel && ITEMS[local.mapSel] && D.GEO[local.mapSel] ? local.mapSel : null;
    const row = sel && R.rows.find(r => r.id === sel);
    const walk = R.rows.reduce((a, r) => a + (r.walk || 0), 0);
    const sh = $("#sheet"); sh.classList.toggle("open", !!sel);
    const who = !SYNC_ON ? "" : `<select class="meSel" onchange="A.me(this.value)"><option value="">Which phone is this?</option>${D.ADULTS.map(p => `<option value="${p}" ${local.me === p ? "selected" : ""}>${esc(D.PEOPLE[p].name)}</option>`).join("")}</select>`;
    sh.innerHTML = !sel ? `<div class="strip"><span><b>${rows.length}</b> stops</span><span><b>${walk}</b> min walking</span><span>Tap a pin</span></div>
        ${SYNC_ON ? `<div class="mehost">${local.me ? `<span>Sharing as <b>${esc(D.PEOPLE[local.me].name)}</b></span>` : `<span>Share your spot with the group</span>`}${who}</div>` : ""}
        ${mapMsg ? `<p class="hint">${esc(mapMsg)}</p>` : ""}
        ${!compassOn ? `<button class="btn primary dirbtn" onclick="A.compass()">Show which way I'm facing</button>` : ""}${compassMsg ? `<p class="hint">${esc(compassMsg)}</p>` : ""}`
      : row ? sheetRow(R, row, ITEMS[sel], curId) : sheetGhost(R, ITEMS[sel]);
  }

  function render() {
    const R = compute();
    const nowM = now();
    const pending = R.rows.filter(r => !r.done);
    $("#clock").textContent = fmt(nowM);
    const views = { now: renderNow, day: renderDay, family: renderFamily, settings: renderSettings };
    const isMap = local.tab === "map";
    document.body.classList.toggle("maptab", isMap);
    $("#mapwrap").hidden = !isMap;
    if (isMap) renderMap(R); else $("#view").innerHTML = (views[local.tab] || renderNow)(R);
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === local.tab));
    renderSync();
  }

  const start = () => {
    render();
    pull(); pullPos();
    if (SYNC_ON) { setInterval(pull, 5000); setInterval(pullPos, 10000); setInterval(pushPos, 10000); }
    // Skip the minute refresh while someone is typing, so a half-typed answer is not wiped.
    setInterval(() => { const a = document.activeElement; if (document.visibilityState === "visible" && !(a && /^(INPUT|TEXTAREA)$/.test(a.tagName))) render(); }, 60000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { pull(); pullPos(); relocate(); render(); } });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
