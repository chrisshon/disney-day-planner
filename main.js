/*
  Start-up. Decides what to show when the page opens:
    1. Nothing saved yet, or the address ends in ?setup  ->  the setup questions.
    2. A join link (#join=...) from someone in the group  ->  load their plan, then open it.
    3. Otherwise  ->  build today's plan from the saved answers and open the app.
  Everything is kept in this browser's local storage under the keys dd-profile, dd-state, dd-local, dd-sync.
*/
(function () {
  const K = window.DDK, CFG = window.DD_CONFIG || {};
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  const del = k => { try { localStorage.removeItem(k); } catch (e) { } };
  const setupEl = document.getElementById("setup");
  const wantSetup = /[?&]setup\b/.test(location.search);

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const HOST_OK = /^https:\/\/[a-z0-9-]{3,63}\.supabase\.co$/i; // invite links may only point at a Supabase project
  const SLUG_OK = /^[A-Za-z0-9_-]{8,64}$/;

  function readProfile() { try { const p = JSON.parse(get("dd-profile") || "null"); return p && p.v === 1 ? p : null; } catch (e) { return null; } }

  function loadApp() {
    return new Promise((ok, fail) => { const s = document.createElement("script"); s.src = "app.js"; s.onload = ok; s.onerror = () => fail(new Error("app.js did not load")); document.body.appendChild(s); });
  }

  function showNote(title, body, retry) {
    setupEl.hidden = false; document.body.classList.add("setup");
    setupEl.innerHTML = `<p class="eyebrow">Disney Day Planner</p><h1>${title}</h1><p class="lead">${body}</p><div class="nav">${retry ? `<button class="btn primary" id="retry">Try again</button>` : ""}<button class="btn" id="fresh">Start my own plan</button></div>`;
    const r = document.getElementById("retry"); if (r) r.onclick = () => location.reload();
    document.getElementById("fresh").onclick = () => { location.href = location.pathname + "?setup"; };
  }

  /* A join link carries the group's id (and the project address, if it is not in config.js). The trip details come from the group's saved plan. */
  async function handleJoin() {
    const m = /#join=([^&]+)/.exec(location.hash); if (!m) return true;
    let o; try { o = JSON.parse(atob(decodeURIComponent(m[1]))); } catch (e) { o = null; }
    if (!o || typeof o !== "object" || Array.isArray(o)) o = null;
    const c = CFG.sharing || {};
    const str = v => (typeof v === "string" ? v : "");
    const url = (str(o && o.u) || str(c.url)).trim().replace(/\/+$/, ""), key = (str(o && o.k) || str(c.key)).trim(), slug = str(o && o.s);
    history.replaceState(null, "", location.pathname + location.search);
    if (!o || !SLUG_OK.test(slug) || !url || key.length < 20 || key.length > 500) { showNote("That link looks incomplete", "Ask whoever sent it to copy the invite link again from Settings.", false); return false; }
    if (!HOST_OK.test(url)) { showNote("That link points somewhere unexpected", "Invite links only work with a Supabase project address that ends in .supabase.co. Ask whoever sent it to copy the invite link again from Settings.", false); return false; }
    // Opening a link must never silently wipe a plan already on this phone.
    let mine = {}; try { mine = JSON.parse(get("dd-sync") || "{}") || {}; } catch (e) { }
    if (get("dd-profile") && mine.slug !== slug && !confirm("This link will replace the plan saved on this phone with your group's plan. Replace it?")) return true;
    try {
      const r = await fetch(`${url}/rest/v1/disney_plan?slug=eq.${encodeURIComponent(slug)}&select=state,updated_at`, { headers: { apikey: key, Authorization: `Bearer ${key}`, "x-group": slug } });
      if (!r.ok) throw new Error(r.status);
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length || !rows[0].state || !rows[0].state.profile) { showNote("That group has no plan yet", "Ask whoever sent the link to open the app once so their plan saves, then try again.", true); return false; }
      const prof = rows[0].state.profile;
      try { K.checkProfile(prof); if (prof.v !== 1) throw new Error("version"); } catch (e) { showNote("That group's plan could not be read", "Ask whoever sent the link to open the app once and send the link again.", false); return false; }
      del("dd-acked");
      set("dd-sync", JSON.stringify({ url, key, slug }));
      set("dd-profile", JSON.stringify(prof));
      set("dd-state", JSON.stringify({ ...rows[0].state, updatedAt: rows[0].updated_at }));
      return true;
    } catch (e) {
      showNote("Could not reach the group's plan", "Check your connection and try again. The plan is stored in your group's own project, not on this phone.", true); return false;
    }
  }

  function startSetup(initial) {
    window.DDSetup.run({
      initial,
      onCancel: initial ? () => { location.href = location.pathname; } : null,
      onDone: profile => {
        set("dd-profile", JSON.stringify(profile));
        del("dd-state"); del("dd-intro"); del("dd-acked");
        if (get("dd-sync")) set("dd-force-push", "1"); // the new plan replaces the group's old one
        location.replace(location.pathname);
      },
    });
  }

  async function boot() {
    if (!(await handleJoin())) return;
    const profile = readProfile();
    if (wantSetup || !profile) return startSetup(profile);

    let D;
    try { D = K.build(profile); } catch (e) {
      showNote("Your saved answers need a refresh", esc(e.message || e), false); return;
    }
    window.DD = D;
    document.title = (D.GROUP ? D.GROUP + " " : "") + "Disney day";
    const [y, m, d] = D.DAY.split("-").map(Number);
    const dl = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    const label = D.PARK_LABEL || "Disneyland Park";
    document.getElementById("eyebrow").textContent = label + " · " + dl;
    const mt = document.querySelector(".maptitle .eyebrow"); if (mt) mt.textContent = D.SECOND ? "Disneyland Resort" : label; // the short name fits beside the map buttons
    document.getElementById("heading").innerHTML = (D.GROUP ? D.GROUP.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])) + " " : "Your ") + "<em>day</em>";
    try { await loadApp(); } catch (e) { showNote("Something did not load", "Refresh the page. If it keeps happening, check your connection.", true); return; }
    window.DDIntro.run(D);
  }

  boot();
})();
