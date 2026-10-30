/*
  First-open setup. Five short screens: park and date, who is coming, naps and breaks, must-do rides, special occasion.
  It never edits a code file. The answers become a "profile" saved on the device, and planner.js builds the day from it.
  Reopen it any time from Settings (Redo setup) or by adding ?setup to the address.
*/
window.DDSetup = (function () {
  const K = window.DDK; const T = K.T;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const TOUR = ["ms", "hub", "ff", "fl", "tt", "tl", "al", "nos", "fr", "cc", "ge"];
  let S, step = 0, err = "", root, opts, napTouched = false;

  const timeOpts = (from, to, by, cur) => { let h = ""; for (let m = from; m <= to; m += by) h += `<option value="${m}" ${m === cur ? "selected" : ""}>${K.fmtT(m)}</option>`; return h; };
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const heightOf = p => p.kid ? (p.inches || K.estimateInches(p.age)) : 66;
  const setPath = (path, val) => { const parts = path.split("."); let o = S; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]; o[parts[parts.length - 1]] = val; };

  /* ---------- screens ---------- */
  const SCREENS = [
    {
      eyebrow: "Step 1 of 5", title: "Where and <em>when</em>",
      lead: "A few quick questions build your day plan. It takes about two minutes and everything stays on this device.",
      html: () => `
        <label class="sfield">Park
          <select data-k="park"><option value="disneyland" selected>Disneyland Park, Anaheim</option></select>
          <small>Disneyland Park is the only park built in so far. The README shows how to ask Claude Code to add another.</small>
        </label>
        <label class="sfield">Date of your visit
          <input type="date" data-k="date" data-t="str" value="${esc(S.date)}" min="${todayStr()}">
        </label>
        <div class="two">
          <label class="sfield">Arrive by<select data-k="arrive" data-t="num">${timeOpts(T(7, 0), T(11, 0), 30, S.arrive)}</select><small>At the parking structure</small></label>
          <label class="sfield">Out of the park by<select data-k="leave" data-t="num">${timeOpts(T(14, 0), T(22, 30), 30, S.leave)}</select><small>The plan trims to fit</small></label>
        </div>
        <label class="tog"><div><span>We bought Lightning Lane Multi Pass</span><small>Adds the booking reminders and shows which rides it covers</small></div><input type="checkbox" data-k="multiPass" data-t="bool" ${S.multiPass ? "checked" : ""}></label>`,
      check: () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(S.date || "")) return "Pick the date of your visit.";
        if (S.date < todayStr()) return "That date has already passed. Pick today or a later day.";
        if (S.leave - S.arrive < 240) return "Leave at least four hours between arriving and leaving.";
      },
    },
    {
      eyebrow: "Step 2 of 5", title: "Who is <em>coming</em>",
      lead: "Names and the kids' ages. Heights decide which rides everyone can do, so enter a height if you know it. If you do not, the app estimates it from age.",
      html: () => `
        <label class="sfield">Trip name <small>Optional. It becomes the title, like The Rivera family.</small>
          <input data-k="groupName" data-t="str" value="${esc(S.groupName)}" placeholder="The Rivera family" maxlength="40" autocomplete="off">
        </label>
        ${S.people.map((p, i) => `
          <div class="person-card">
            ${S.people.length > 1 ? `<button class="rm" data-rm="${i}" aria-label="Remove ${esc(p.name || "this person")}">×</button>` : ""}
            <label class="sfield">Name<input data-k="people.${i}.name" data-t="str" value="${esc(p.name)}" placeholder="First name" maxlength="20" autocomplete="off"></label>
            <div class="seg2" role="group" aria-label="Adult or child"><button data-kid="${i}:0" class="${p.kid ? "" : "on"}">Adult</button><button data-kid="${i}:1" class="${p.kid ? "on" : ""}">Child</button></div>
            ${p.kid ? `<div class="two">
              <label class="sfield">Age<select data-k="people.${i}.age" data-t="num" data-redraw="1">${Array.from({ length: 18 }, (_, a) => `<option value="${a}" ${p.age === a ? "selected" : ""}>${a === 0 ? "Under 1" : a}</option>`).join("")}</select></label>
              <label class="sfield">Height<select data-k="people.${i}.inches" data-t="numOrNull" data-redraw="1"><option value="">Estimate it</option>${Array.from({ length: 39 }, (_, h) => 28 + h).map(h => `<option value="${h}" ${p.inches === h ? "selected" : ""}>${h} in</option>`).join("")}</select></label>
            </div>
            ${!p.inches && p.age != null ? `<p class="lead" style="margin:0;font-size:13px">Estimated at about ${K.estimateInches(p.age)} in. Measure before you go if a ride limit matters.</p>` : ""}` : ""}
          </div>`).join("")}
        <button class="btn" data-add="1">+ Add another person</button>`,
      check: () => {
        S.people.forEach(p => { p.name = (p.name || "").trim(); });
        if (S.people.some(p => !p.name)) return "Give everyone a name, or remove the empty row.";
        if (!S.people.some(p => !p.kid)) return "At least one adult needs to be in the group.";
        if (S.people.some(p => p.kid && p.age == null)) return "Choose an age for each child.";
        if (S.people.length > 10) return "The planner handles up to 10 people.";
      },
    },
    {
      eyebrow: "Step 3 of 5", title: "Naps, breaks and <em>meals</em>",
      lead: "The plan puts these in first and builds the rides around them.",
      html: () => `
        <label class="tog"><div><span>Someone needs a nap or quiet break</span><small>A rest stop in the middle of the day, trimmed automatically if a show needs the time</small></div><input type="checkbox" data-k="nap.on" data-t="bool" data-redraw="1" ${S.nap.on ? "checked" : ""}></label>
        ${S.nap.on ? `<div class="two">
          <label class="sfield">Earliest start<select data-k="nap.start" data-t="num">${timeOpts(T(11, 0), T(15, 0), 30, S.nap.start)}</select></label>
          <label class="sfield">How long<select data-k="nap.length" data-t="num">${[30, 45, 60, 90].map(m => `<option value="${m}" ${S.nap.length === m ? "selected" : ""}>${m} minutes</option>`).join("")}</select></label>
        </div>` : ""}
        <div class="two">
          <label class="sfield">Lunch around<select data-k="lunch" data-t="num">${timeOpts(T(11, 0), T(13, 30), 30, S.lunch)}</select></label>
          <label class="sfield">Dinner around<select data-k="dinner" data-t="num">${timeOpts(T(16, 30), T(19, 0), 30, S.dinner)}</select></label>
        </div>`,
      check: () => { if (S.dinner - S.lunch < 240) return "Leave at least four hours between lunch and dinner."; },
    },
    {
      eyebrow: "Step 4 of 5", title: "Your must-do <em>rides</em>",
      lead: "Tap anything you do not want to miss. The plan puts these in first and fills the rest of the day around them. Skip this and the planner picks a good mix.",
      html: () => {
        const names = S.people.map(p => ({ n: p.name, h: heightOf(p) }));
        const KO = { ride: 0, meet: 1, show: 2, meal: 3, treat: 4 };
        const items = K.CATALOG.filter(c => c.kind !== "break").sort((a, b) => (KO[a.kind] ?? 5) - (KO[b.kind] ?? 5));
        const lands = TOUR.filter(l => items.some(i => i.land === l));
        const sel = new Set(S.mustDo);
        return `<p class="grp" style="margin-top:0">${sel.size} chosen</p>` + lands.map(l => `
          <p class="grp">${esc(K.LANDS[l].name)}</p>
          ${items.filter(i => i.land === l).map(i => {
            const short = i.minInches ? names.filter(x => x.h < i.minInches) : [];
            const note = i.minInches ? (short.length === names.length ? `<span class="warn">${i.minInches} in, nobody is tall enough</span>` : short.length ? `${i.minInches} in. ${esc(short.map(x => x.n).join(", "))} too short, use Rider Switch` : `${i.minInches} in, everyone clears it`) : (i.kind === "ride" ? "Any height" : i.kind === "meet" ? "Character meet" : "Show");
            return `<button class="pick ${sel.has(i.id) ? "on" : ""}" data-pick="${i.id}" ${i.minInches && short.length === names.length ? "disabled style=opacity:.4" : ""}>
              <span class="thumb art" style="--c:${K.LANDS[i.land].color}"><i>${i.icon || "✦"}</i></span>
              <span><b>${esc(i.title)}</b><small>${note}</small></span><span class="mark">✓</span></button>`;
          }).join("")}`).join("");
      },
      check: () => {},
    },
    {
      eyebrow: "Step 5 of 5", title: "Celebrating <em>anything</em>",
      lead: "Birthdays, anniversaries and first visits add a free City Hall button and a treat stop to the day.",
      html: () => `
        <div class="chips" role="group" aria-label="Occasion">${[["none", "Nothing special"], ["birthday", "Birthday"], ["anniversary", "Anniversary"], ["first", "First visit"], ["other", "Something else"]].map(([v, l]) => `<button data-occ="${v}" class="${S.occasion.type === v ? "on" : ""}">${l}</button>`).join("")}</div>
        ${S.occasion.type === "birthday" ? `<label class="sfield">Whose birthday?<select data-k="occasion.forId" data-t="str"><option value="all" ${S.occasion.forId === "all" ? "selected" : ""}>Not sure / everyone</option>${S.people.map(p => `<option value="${p.id}" ${S.occasion.forId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : ""}
        ${S.occasion.type === "other" ? `<label class="sfield">What are you celebrating?<input data-k="occasion.label" data-t="str" value="${esc(S.occasion.label)}" placeholder="Graduation, retirement, a big win" maxlength="40" autocomplete="off"></label>` : ""}
        <div class="recap">${recap()}</div>`,
      check: () => {},
    },
  ];

  function recap() {
    const d = S.date ? new Date(S.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "your day";
    const kids = S.people.filter(p => p.kid).length, ad = S.people.length - kids;
    return `<b>Disneyland Park</b>, ${esc(d)}<br>${ad} adult${ad === 1 ? "" : "s"}${kids ? ` and ${kids} child${kids === 1 ? "" : "ren"}` : ""}<br>In the gate about <b>${K.fmtT(S.arrive + 30)}</b>, out by <b>${K.fmtT(S.leave)}</b><br>${S.nap.on ? `Break around ${K.fmtT(S.nap.start)}` : "No nap or break"}, lunch ${K.fmtT(S.lunch)}, dinner ${K.fmtT(S.dinner)}<br>${S.mustDo.length} must-do ${S.mustDo.length === 1 ? "stop" : "stops"}${S.multiPass ? ", Lightning Lane Multi Pass" : ""}`;
  }

  /* ---------- rendering ---------- */
  function render() {
    const sc = SCREENS[step]; const last = step === SCREENS.length - 1;
    root.innerHTML = `
      <div class="dots">${SCREENS.map((_, i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>
      <p class="eyebrow">${sc.eyebrow}</p><h1>${sc.title}</h1><p class="lead">${sc.lead}</p>
      <div class="body">${sc.html()}${err ? `<p class="err" role="alert">${esc(err)}</p>` : ""}</div>
      <div class="nav">
        ${step > 0 ? `<button class="btn" data-nav="back">Back</button>` : (opts.onCancel ? `<button class="btn" data-nav="cancel">Keep my plan</button>` : "")}
        <button class="btn primary" data-nav="${last ? "finish" : "next"}">${last ? "Build my day" : "Next"}</button>
      </div>`;
    window.scrollTo(0, 0);
    wire();
  }
  function rerenderKeepScroll() { const y = window.scrollY; const a = document.activeElement; const key = a && a.getAttribute && a.getAttribute("data-k"); render(); window.scrollTo(0, y); if (key) { const el = root.querySelector(`[data-k="${key}"]`); if (el && el.tagName !== "SELECT") el.focus(); } }

  function wire() {
    root.querySelectorAll("[data-k]").forEach(el => {
      const ev = el.tagName === "INPUT" && el.type === "text" ? "input" : "change";
      el.addEventListener(ev, () => {
        const t = el.getAttribute("data-t"); const path = el.getAttribute("data-k");
        let v = el.type === "checkbox" ? el.checked : el.value;
        if (t === "num") v = +v; else if (t === "numOrNull") v = v === "" ? null : +v;
        setPath(path, v); err = "";
        if (path === "nap.on") napTouched = true;
        if (el.getAttribute("data-redraw")) rerenderKeepScroll();
      });
      if (el.type === "date") el.addEventListener("input", () => { setPath(el.getAttribute("data-k"), el.value); });
    });
    root.querySelectorAll("[data-kid]").forEach(b => b.addEventListener("click", () => {
      const [i, k] = b.getAttribute("data-kid").split(":").map(Number); const p = S.people[i];
      p.kid = !!k; if (p.kid && p.age == null) p.age = 6; if (!p.kid) { p.inches = null; } rerenderKeepScroll();
    }));
    root.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { S.people.splice(+b.getAttribute("data-rm"), 1); rerenderKeepScroll(); }));
    const add = root.querySelector("[data-add]");
    if (add) add.addEventListener("click", () => { const n = S.people.reduce((m, p) => Math.max(m, +String(p.id).replace(/\D/g, "") || 0), 0) + 1; S.people.push({ id: "p" + n, name: "", kid: false, age: null, inches: null }); rerenderKeepScroll(); });
    root.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", () => {
      const id = b.getAttribute("data-pick"); const i = S.mustDo.indexOf(id);
      if (i >= 0) S.mustDo.splice(i, 1); else S.mustDo.push(id);
      rerenderKeepScroll();
    }));
    root.querySelectorAll("[data-occ]").forEach(b => b.addEventListener("click", () => { S.occasion.type = b.getAttribute("data-occ"); rerenderKeepScroll(); }));
    root.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => {
      const a = b.getAttribute("data-nav");
      if (a === "cancel") return opts.onCancel();
      if (a === "back") { step = Math.max(0, step - 1); err = ""; return render(); }
      const e = SCREENS[step].check(); if (e) { err = e; return render(); }
      if (a === "next") {
        step++; err = "";
        if (step === 2 && !napTouched) { S.nap.on = S.people.some(p => p.kid && p.age != null && p.age <= 5); }
        return render();
      }
      // finish
      for (let i = 0; i < SCREENS.length - 1; i++) { const e2 = SCREENS[i].check(); if (e2) { step = i; err = e2; return render(); } }
      const profile = clone(S);
      profile.mustDo = profile.mustDo.filter(id => K.CATALOG.some(c => c.id === id));
      if (profile.occasion.type !== "birthday") profile.occasion.forId = "all";
      if (profile.occasion.type !== "other") profile.occasion.label = "";
      try { K.build(profile); } catch (ex) { err = String(ex.message || ex); return render(); }
      opts.onDone(profile);
    }));
  }

  function run(o) {
    opts = o; step = 0; err = ""; napTouched = !!o.initial;
    S = clone(Object.assign(K.defaultProfile(), o.initial || {}));
    if (!S.people.length) S.people = K.defaultProfile().people;
    root = document.getElementById("setup"); root.hidden = false;
    document.body.classList.add("setup");
    render();
  }
  return { run };
})();
