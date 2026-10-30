/*
  Planner: turns the setup answers (a "profile") plus the park catalog into one day.
  DDK.build(profile) returns the object the app runs on (called D in app.js).
  Nothing here talks to a server. The same profile always produces the same plan.
*/
(function (K) {
  const { T, LANDS, WALK, CATALOG, GEO, LAND_GEO, HEIGHT_BY_AGE, DL, att, dine } = K;
  const PALETTE = ["#4f8fe0", "#e0609f", "#f08a3c", "#8e63d6", "#3fa877", "#d9a21f", "#2fa7b8", "#d45d5d", "#7a8cff", "#c26cc0"];
  const KIDDY = new Set(["carrousel", "dumbo", "caseyjr", "madtea", "minniehouse", "gadget", "centoonial", "duckpond", "royalhall"]);

  K.PALETTE = PALETTE;
  K.defaultProfile = () => ({
    v: 1, park: "disneyland", date: "", arrive: T(8, 30), leave: T(19, 0), groupName: "",
    people: [{ id: "p1", name: "", kid: false, age: null, inches: null }],
    multiPass: false,
    nap: { on: false, start: T(12, 30), length: 60 },
    lunch: T(11, 30), dinner: T(17, 30),
    mustDo: [],
    occasion: { type: "none", forId: "all", label: "" },
  });

  K.estimateInches = age => HEIGHT_BY_AGE[Math.max(0, Math.min(HEIGHT_BY_AGE.length - 1, age == null ? 8 : age))];

  K.build = function (profile) {
    const P = Object.assign(K.defaultProfile(), profile);
    const people = P.people.filter(p => p.name && p.name.trim());
    if (!people.some(p => !p.kid)) throw new Error("At least one adult is needed.");

    /* ---- people ---- */
    const PEOPLE = {}; const ALL = []; const used = {};
    people.forEach((p, i) => {
      const id = p.id || "p" + (i + 1); ALL.push(id);
      const name = p.name.trim();
      let short = name[0].toUpperCase(); if (used[short]) short = name.slice(0, 2); used[short] = 1;
      PEOPLE[id] = { name, short, color: PALETTE[i % PALETTE.length], role: p.kid ? "kid" : "adult",
        age: p.kid ? p.age : null, inches: p.kid ? (p.inches || K.estimateInches(p.age)) : (p.inches || 66), estimated: p.kid && !p.inches };
    });
    const ADULTS = ALL.filter(id => PEOPLE[id].role === "adult");
    const KIDS = ALL.filter(id => PEOPLE[id].role === "kid");
    const youngest = KIDS.length ? Math.min(...KIDS.map(id => PEOPLE[id].age == null ? 8 : PEOPLE[id].age)) : 99;
    const shortest = Math.min(...ALL.map(id => PEOPLE[id].inches));
    const lead = ADULTS[0];

    /* ---- occasion ---- */
    const oc = P.occasion || { type: "none" };
    const ocName = oc.forId && oc.forId !== "all" && PEOPLE[oc.forId] ? PEOPLE[oc.forId].name : "";
    const OCC = oc.type === "none" ? null : (() => {
      const o = { birthday: ["Birthday", ocName ? `${ocName}'s birthday` : "Birthday"], anniversary: ["Anniversary", "Anniversary"], first: ["First-visit", "First visit"], other: ["Celebration", (oc.label || "").trim() || "Celebrating"] }[oc.type] || ["Celebration", "Celebrating"];
      return { kind: oc.type, word: o[0], tag: o[1], who: ocName, label: (oc.label || "").trim() };
    })();

    /* ---- catalog for this group ---- */
    const items = CATALOG.map(c => Object.assign({}, c, { who: ALL.slice(), ll: P.multiPass ? !!c.ll : false }));
    const byId = {}; items.forEach(i => byId[i.id] = i);
    const must = new Set((P.mustDo || []).filter(id => byId[id]));
    must.forEach(id => { byId[id].priority = 5; });

    /* ---- fixed stops ---- */
    const arrive = P.arrive, leave = P.leave;
    const lunchAt = P.lunch, dinnerAt = P.dinner;
    const gate = { id: "gate", kind: "travel", title: "Park, tram, security, gate", land: "gate", dur: 30, fixedAt: arrive, lock: true, who: ALL.slice(), icon: "🎟️",
      note: "Have tickets open in the Disneyland app before you reach the tram. Strollers go through security.", link: `${DL}/guest-services/download-disneyland-mobile-app/` };
    const exit = { id: "exit", kind: "travel", title: "Walk out, tram, drive home", land: "gate", dur: 30, lock: true, who: ALL.slice(), icon: "🚗",
      note: `Aim to be out of the park by ${fmtT(leave)}.`, link: `${DL}/guest-services/parking/` };
    const lunch = { id: "lunch", kind: "meal", title: "Lunch in Toontown", land: "tt", dur: 45, priority: 5, lock: true, who: ALL.slice(), icon: "🍕", window: [lunchAt, lunchAt + 120],
      note: "Café Daisy (pizza, hot dogs) or Good Boy! Grocers (grab and go) are both in Toontown. Red Rose Taverne in Fantasyland is the backup. Mobile order in the app 20 minutes ahead.", link: dine("cafe-daisy") };
    const dinner = { id: "dinner", kind: "meal", title: "Dinner near Main Street", land: "ms", dur: 45, priority: 5, lock: true, who: ALL.slice(), icon: "🍗", window: [dinnerAt, dinnerAt + 120],
      note: "Plaza Inn (fried chicken, kids' plates) is close to the hub. Mobile order ahead if you can.", link: dine("plaza-inn") };
    const lastlook = { id: "lastlook", kind: "treat", title: "Main Street shops and a last look", land: "ms", dur: 20, priority: 2, who: ALL.slice(), icon: "🛍️",
      note: "The Emporium for a souvenir and a castle photo in the evening light.", link: `${DL}/shops/disneyland/` };
    const nap = !P.nap.on ? null : { id: "nap", kind: "break", title: "Nap or quiet break", land: "tt", dur: P.nap.length, minDur: Math.max(25, Math.round(P.nap.length * 0.6)), priority: 4, who: ALL.slice(), icon: "😴",
      window: [P.nap.start, P.nap.start + 180], napWindow: true,
      note: "Ride the Disneyland Railroad for a calm 20-minute loop, then keep strolling or find shade and sit. Cut short automatically if a show or ride needs the time.", link: att("disneyland-railroad") };
    const tasks = [];
    if (P.multiPass) {
      const bookNote = "Open the Disneyland app and pick the ride with the soonest window. Then tap that ride here, choose Return time, and type the window. The ride moves to match.";
      tasks.push({ id: "ll1", kind: "task", title: "Book first Lightning Lane", land: "ms", dur: 3, priority: 5, who: [lead], icon: "📱", ll: "book", note: bookNote, link: `${DL}/guest-services/lightning-lane-passes/` });
      tasks.push({ id: "ll2", kind: "task", title: "Book next Lightning Lane", land: "tt", dur: 2, priority: 5, who: [lead], icon: "📱", ll: "book",
        note: "Opens when you scan into the last one, or 2 hours after you booked it. Take the soonest window. " + bookNote, link: `${DL}/guest-services/lightning-lane-passes/` });
      tasks.push({ id: "ll3", kind: "task", title: "Book next Lightning Lane", land: "tl", dur: 2, priority: 4, who: [lead], icon: "📱", ll: "book",
        note: "Same rule as before. If the window lands too late in the day, skip it.", link: `${DL}/guest-services/lightning-lane-passes/` });
    }
    let occTask = null, occTreat = null;
    if (OCC) {
      occTask = { id: "occasion", kind: "task", title: `${OCC.kind === "birthday" ? (OCC.who ? OCC.who + "'s birthday" : "Birthday") : OCC.kind === "anniversary" ? "Anniversary" : OCC.kind === "first" ? "First-visit" : "Celebration"} button at City Hall`,
        land: "ms", dur: 6, priority: 5, who: ALL.slice(), icon: "🎉", occasion: OCC.tag,
        note: "Free. Ask for a celebration button at City Hall on Main Street and wear it all day. Cast members will say hello. " + (OCC.label && OCC.kind === "other" ? `Tell them: ${OCC.label}.` : ""), link: `${DL}/guest-services/info-center-guest-relations/` };
      occTreat = { id: "treat", kind: "treat", title: `${OCC.word} treat`, land: "hub", dur: 20, priority: 4, who: ALL.slice(), icon: "🧁", occasion: OCC.tag,
        note: "Pick a treat to celebrate. Jolly Holiday Bakery Cafe on the hub is an easy one, with seats near the castle.", link: dine("jolly-holiday-bakery-cafe") };
    }

    /* ---- pick the stops ---- */
    const chosen = [];
    const take = i => { if (!chosen.includes(i)) chosen.push(i); };
    items.filter(i => must.has(i.id)).forEach(take);
    const fixedMin = 45 + 45 + (nap ? nap.dur : 0) + (occTask ? occTask.dur + occTreat.dur : 0) + lastlook.dur;
    const avail = Math.max(60, (leave - 30) - (arrive + 30) - fixedMin);
    const spent = () => chosen.reduce((a, i) => a + i.dur + 6, 0);
    const youngSoon = youngest < 4, youngKid = youngest < 7;
    const pool = items.filter(i => !must.has(i.id) && i.priority >= 2 && i.kind !== "break"
      && !(i.minInches && i.minInches > shortest) && !(i.thrill && youngKid) && !(i.scary && youngSoon)
      && !(KIDDY.has(i.id) && !KIDS.length) && !(i.kind === "meet" && !KIDS.length))
      .sort((a, b) => b.priority - a.priority || CATALOG.indexOf(a) - CATALOG.indexOf(b));
    for (const i of pool) { if (spent() + i.dur + 6 > avail * 0.92) continue; take(i); }

    /* ---- put them in a walkable order ---- */
    const events = [{ it: lunch, at: lunchAt }, { it: dinner, at: dinnerAt }];
    if (nap) events.push({ it: nap, at: P.nap.start });
    events.sort((a, b) => a.at - b.at);
    const out = [gate]; const early = [];
    if (tasks[0]) early.push(tasks[0]);
    if (occTask) early.push(occTask);
    early.forEach(x => out.push(x));
    let t = arrive + 30 + (occTask ? occTask.dur + 5 : 0), cur = early.length ? "ms" : "gate";
    const left = chosen.slice(); if (occTreat) left.push(occTreat);
    const walk = (a, b) => (WALK[a] && isFinite(WALK[a][b]) ? WALK[a][b] : 6);
    const TOUR = ["ms", "hub", "ff", "fl", "tt", "tl", "al", "nos", "cc", "ge", "fr"];
    const fits = (it, from, landFrom, limit) => {
      const s = from + walk(landFrom, it.land);
      if (it.window && (s < it.window[0] || s > it.window[1])) return false;
      return s + it.dur <= limit;
    };
    const fill = (limit, bias) => {
      for (;;) {
        let best = null, bs = Infinity;
        left.forEach(it => {
          if (!fits(it, t, cur, limit)) return;
          const s = walk(cur, it.land) + (5 - (it.priority || 3)) * 0.9 - (must.has(it.id) ? 3 : 0) + (TOUR.indexOf(it.land) * bias);
          if (s < bs) { bs = s; best = it; }
        });
        if (!best) break;
        t += walk(cur, best.land) + best.dur; cur = best.land; out.push(best); left.splice(left.indexOf(best), 1);
      }
    };
    events.forEach((ev, n) => {
      fill(ev.at - 5, n === 0 ? 0.6 : 0.25);
      let it = ev.it;
      if (it.id === "nap") { it = Object.assign({}, nap, { land: cur }); }
      out.push(it); t = Math.max(t + walk(cur, it.land), ev.at) + it.dur; cur = it.land;
    });
    // Stops still unplaced go after dinner, in tour order. Must-dos stay in the plan (the planner flags them if the day is too full); the rest become "add a stop" options.
    left.sort((a, b) => TOUR.indexOf(a.land) - TOUR.indexOf(b.land));
    fill(leave - 30 - lastlook.dur - 5, 0.1);
    left.filter(it => must.has(it.id) || it.id === "treat").forEach(it => out.push(it));
    const dinnerAtIdx = out.findIndex(p => p.id === "dinner");
    tasks.slice(1).forEach(tk => out.splice(dinnerAtIdx < 0 ? out.length : dinnerAtIdx, 0, tk));
    out.push(lastlook, exit);
    // Anything tall enough for the whole group but not chosen, and everything else, is addable later.
    const PLAN = out;
    const inPlan = new Set(PLAN.map(p => p.id));
    const BONUS = items.filter(i => !inPlan.has(i.id));

    /* ---- geo ---- */
    const G = Object.assign({}, GEO);
    const napItem = PLAN.find(p => p.id === "nap");
    if (napItem) G.nap = LAND_GEO[napItem.land] || LAND_GEO.hub;

    const LL_ORDER = PLAN.concat(BONUS).filter(i => i.ll === true).sort((a, b) => b.priority - a.priority).slice(0, 6).map(i => i.id);

    return {
      PROFILE: P, DAY: P.date, START: arrive, GROUP: (P.groupName || "").trim(), OCC,
      IMG: {}, T, PEOPLE, ALL, ADULTS, KIDS, LANDS, WALK, PLAN, BONUS, LL_ORDER, DL, GEO: G, LAND_GEO,
      MULTI: !!P.multiPass,
      DEFAULT_PREFS: { departure: leave, napOn: !!P.nap.on, lean: "balanced", heights: {} },
    };
  };

  function fmtT(m) { let h = Math.floor(m / 60) % 24, mm = m % 60; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + ":" + String(mm).padStart(2, "0") + " " + ap; }
  K.fmtT = fmtT;
})(window.DDK);
