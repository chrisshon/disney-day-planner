/*
  Planner: turns the setup answers (a "profile") plus the park catalog into one day, in one park or hopping between the two.
  DDK.build(profile) returns the object the app runs on (called D in app.js).
  Nothing here talks to a server. The same profile always produces the same plan.
*/
(function (K) {
  const { T, LANDS, WALK, CATALOG, GEO, LAND_GEO, HEIGHT_BY_AGE, DL, att, dine, catt, cdine, PARKS, parkOf } = K;
  const PALETTE = ["#4f8fe0", "#e0609f", "#f08a3c", "#8e63d6", "#3fa877", "#d9a21f", "#2fa7b8", "#d45d5d", "#7a8cff", "#c26cc0"];
  const KIDDY = new Set(["carrousel", "dumbo", "caseyjr", "madtea", "minniehouse", "gadget", "centoonial", "duckpond", "royalhall", "jessie", "whirlwind", "jellyfish", "luigis", "mater"]);

  K.PALETTE = PALETTE;
  K.defaultProfile = () => ({
    v: 1, park: "disneyland", hop: { to: "", at: null }, date: "", arrive: T(8, 30), leave: T(19, 0), groupName: "",
    people: [{ id: "p1", name: "", kid: false, age: null, inches: null }],
    multiPass: false,
    nap: { on: false, start: T(12, 30), length: 60 },
    lunch: T(11, 30), dinner: T(17, 30),
    mustDo: [],
    occasion: { type: "none", forId: "all", label: "" },
  });

  K.estimateInches = age => HEIGHT_BY_AGE[Math.max(0, Math.min(HEIGHT_BY_AGE.length - 1, age == null ? 8 : age))];

  /* Stops a saved or shared profile from carrying anything the app cannot safely run. Person ids end up inside page code, so they must look like p1, p2, p3. */
  K.checkProfile = function (p) {
    if (!p || typeof p !== "object" || !Array.isArray(p.people) || p.people.length > 12) throw new Error("The saved answers could not be read.");
    const seen = Object.create(null);
    p.people.forEach(x => {
      if (!x || typeof x !== "object") throw new Error("The saved answers could not be read.");
      if (x.name != null && typeof x.name !== "string") throw new Error("The saved answers could not be read.");
      if (x.id != null && x.id !== "") {
        if (typeof x.id !== "string" || !/^p\d+$/.test(x.id)) throw new Error("A person in the saved answers has an invalid id.");
        if (seen[x.id]) throw new Error("Two people in the saved answers share an id.");
        seen[x.id] = 1;
      }
    });
    // park: where the day starts. hop.to: the second park, or "" for one park all day. hop.at: minutes from midnight, or null to let the planner choose.
    const isPark = k => typeof k === "string" && Object.prototype.hasOwnProperty.call(PARKS, k); // not "constructor" or "__proto__"
    if (p.park != null && !isPark(p.park)) throw new Error("The saved answers name a park this planner does not have.");
    if (p.hop != null) {
      if (typeof p.hop !== "object" || Array.isArray(p.hop)) throw new Error("The saved answers could not be read.");
      const to = p.hop.to;
      if (to != null && to !== "" && !(isPark(to) && to !== (p.park || "disneyland"))) throw new Error("The saved answers hop to a park this planner does not have.");
      if (p.hop.at != null && !(typeof p.hop.at === "number" && isFinite(p.hop.at))) throw new Error("The saved answers could not be read.");
    }
  };

  /* The stops the planner adds itself, worded for each park. Disneyland's are the original ones, unchanged. */
  const GR = `${DL}/guest-services/info-center-guest-relations/`;
  const FIXED = {
    disneyland: {
      lunch: { title: "Lunch in Toontown", land: "tt", icon: "🍕", link: dine("cafe-daisy"),
        note: "Café Daisy (pizza, hot dogs) or Good Boy! Grocers (grab and go) are both in Toontown. Red Rose Taverne in Fantasyland is the backup. Mobile order in the app 20 minutes ahead." },
      dinner: { title: "Dinner near Main Street", land: "ms", icon: "🍗", link: dine("plaza-inn"),
        note: "Plaza Inn (fried chicken, kids' plates) is close to the hub. Mobile order ahead if you can." },
      lastlook: { title: "Main Street shops and a last look", land: "ms", link: `${DL}/shops/disneyland/`,
        note: "The Emporium for a souvenir and a castle photo in the evening light." },
      nap: { link: att("disneyland-railroad"),
        note: "Ride the Disneyland Railroad for a calm 20-minute loop, then keep strolling or find shade and sit. Cut short automatically if a show or ride needs the time." },
      button: { where: "City Hall", land: "ms", note: "Free. Ask for a celebration button at City Hall on Main Street and wear it all day. Cast members will say hello. " },
      treat: { land: "hub", link: dine("jolly-holiday-bakery-cafe"), note: "Pick a treat to celebrate. Jolly Holiday Bakery Cafe on the hub is an easy one, with seats near the castle." },
      ll: ["ms", "tt", "tl"],
    },
    dca: {
      lunch: { title: "Lunch in Cars Land", land: "cl", icon: "🍗", link: cdine("flos-v8-cafe"),
        note: "Flo's V8 Café in Cars Land is a quick-service diner with rotisserie plates and pie. Pym Test Kitchen in Avengers Campus is the backup. Mobile order in the app 20 minutes ahead." },
      dinner: { title: "Dinner in Grizzly Peak", land: "gp", icon: "🍔", link: cdine("smokejumpers-grill"),
        note: "Smokejumpers Grill (burgers, sandwiches, fries) is a short walk from Buena Vista Street. Award Wieners in Hollywood Land (hot dogs) is the backup. Mobile order ahead if you can." },
      lastlook: { title: "Buena Vista Street shops and a last look", land: "bvs", link: `${DL}/shops/disney-california-adventure/`,
        note: "Browse the shops on Buena Vista Street for a souvenir on the way out." },
      nap: { link: catt("mickeys-philharmagic"),
        note: "Find shade and sit, or rest through a show like Mickey's PhilharMagic in the Sunset Showcase Theater. Cut short automatically if a show or ride needs the time." },
      button: { where: "the Chamber of Commerce", land: "bvs", note: "Free. Ask for a celebration button at Guest Relations in the Chamber of Commerce on Buena Vista Street and wear it all day. Cast members will say hello. " },
      treat: { land: "bvs", link: cdine("fiddler-fifer-and-practical-cafe"), note: "Pick a treat to celebrate. Fiddler, Fifer & Practical Café on Buena Vista Street has pastries and desserts." },
      ll: ["bvs", "gp", "pg"],
    },
  };

  K.build = function (profile) {
    K.checkProfile(profile);
    const def = K.defaultProfile();
    const P = Object.assign(def, profile);
    P.nap = Object.assign(K.defaultProfile().nap, profile.nap || {}); // fields added later to nap, occasion or hop fill in for older saved answers
    P.occasion = Object.assign(K.defaultProfile().occasion, profile.occasion || {});
    P.hop = Object.assign(K.defaultProfile().hop, profile.hop || {});
    const people = P.people.filter(p => p.name && p.name.trim());
    if (!people.some(p => !p.kid)) throw new Error("At least one adult is needed.");

    /* ---- parks ---- */
    const own = k => typeof k === "string" && Object.prototype.hasOwnProperty.call(PARKS, k);
    const first = own(P.park) ? P.park : "disneyland";
    const second = P.hop.to && P.hop.to !== first && own(P.hop.to) ? P.hop.to : null;
    const dayParks = second ? [first, second] : [first];
    const last = second || first;
    const F1 = FIXED[first], FL = FIXED[last];

    /* ---- people ---- */
    const PEOPLE = Object.create(null); const ALL = []; const used = {};
    const taken = new Set(people.map(p => p.id).filter(Boolean));
    people.forEach((p, i) => {
      let id = p.id; if (!id) { let n = i + 1; while (taken.has("p" + n)) n++; id = "p" + n; taken.add(id); } ALL.push(id);
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

    /* ---- catalog for this group: only the parks in today's plan ---- */
    const items = CATALOG.filter(c => dayParks.includes(parkOf(c.land))).map(c => Object.assign({}, c, { who: ALL.slice(), ll: P.multiPass ? !!c.ll : false }));
    const byId = {}; items.forEach(i => byId[i.id] = i);
    const must = new Set((P.mustDo || []).filter(id => byId[id]));
    must.forEach(id => { byId[id].priority = 5; });

    /* ---- fixed stops ---- */
    const arrive = P.arrive, leave = P.leave;
    const lunchAt = P.lunch, dinnerAt = P.dinner;
    const gate = { id: "gate", kind: "travel", title: "Park, tram, security, gate", land: PARKS[first].gate, dur: 30, fixedAt: arrive, lock: true, who: ALL.slice(), icon: "🎟️",
      note: "Have tickets open in the Disneyland app before you reach the tram. Strollers go through security." + (second ? ` Your park reservation is for ${PARKS[first].name}. Your Park Hopper ticket lets you switch to ${PARKS[second].short} later in the day.` : ""), link: `${DL}/guest-services/download-disneyland-mobile-app/` };
    const exit = { id: "exit", kind: "travel", title: "Walk out, tram, drive home", land: PARKS[last].gate, dur: 30, lock: true, who: ALL.slice(), icon: "🚗",
      note: `Aim to be out of the park by ${fmtT(leave)}.`, link: `${DL}/guest-services/parking/` };
    const meal = (kind, park) => {
      const m = FIXED[park][kind], at = kind === "lunch" ? lunchAt : dinnerAt;
      return { id: kind, kind: "meal", title: m.title, land: m.land, dur: 45, priority: 5, lock: true, who: ALL.slice(), icon: m.icon, window: [at, at + 120], note: m.note, link: m.link, park };
    };
    const lastlook = { id: "lastlook", kind: "treat", title: FL.lastlook.title, land: FL.lastlook.land, dur: 20, priority: 2, who: ALL.slice(), icon: "🛍️",
      note: FL.lastlook.note, link: FL.lastlook.link };
    const nap = !P.nap.on ? null : { id: "nap", kind: "break", title: "Nap or quiet break", land: "tt", dur: P.nap.length, minDur: Math.max(25, Math.round(P.nap.length * 0.6)), priority: 4, who: ALL.slice(), icon: "😴",
      window: [P.nap.start, P.nap.start + 180], napWindow: true, note: F1.nap.note, link: F1.nap.link };
    const hop = !second ? null : { id: "hop", kind: "travel", title: `Hop to ${PARKS[second].short}`, land: PARKS[second].gate, dur: 5, lock: true, who: ALL.slice(), icon: "🔁",
      note: `Walk across the Esplanade from ${PARKS[first].short} and scan in at the ${PARKS[second].short} gate with your Park Hopper ticket. The plan counts about 10 minutes for the walk and the scan.`, link: `${DL}/guest-services/park-hopper/` };
    const tasks = [];
    if (P.multiPass) {
      const bookNote = "Open the Disneyland app and pick the ride with the soonest window. Then tap that ride here, choose Return time, and type the window. The ride moves to match." + (second ? " With Park Hopper you can book rides in both parks." : "");
      const L3 = F1.ll;
      tasks.push({ id: "ll1", kind: "task", title: "Book first Lightning Lane", land: L3[0], dur: 3, priority: 5, who: [lead], icon: "📱", ll: "book", note: bookNote, link: `${DL}/guest-services/lightning-lane-passes/` });
      tasks.push({ id: "ll2", kind: "task", title: "Book next Lightning Lane", land: L3[1], dur: 2, priority: 5, who: [lead], icon: "📱", ll: "book",
        note: "Opens when you scan into the last one, or 2 hours after you booked it. Take the soonest window. " + bookNote, link: `${DL}/guest-services/lightning-lane-passes/` });
      tasks.push({ id: "ll3", kind: "task", title: "Book next Lightning Lane", land: L3[2], dur: 2, priority: 4, who: [lead], icon: "📱", ll: "book",
        note: "Same rule as before. If the window lands too late in the day, skip it.", link: `${DL}/guest-services/lightning-lane-passes/` });
    }
    let occTask = null, occTreat = null;
    if (OCC) {
      occTask = { id: "occasion", kind: "task", title: `${OCC.kind === "birthday" ? (OCC.who ? OCC.who + "'s birthday" : "Birthday") : OCC.kind === "anniversary" ? "Anniversary" : OCC.kind === "first" ? "First-visit" : "Celebration"} button at ${F1.button.where}`,
        land: F1.button.land, dur: 6, priority: 5, who: ALL.slice(), icon: "🎉", occasion: OCC.tag,
        note: F1.button.note + (OCC.label && OCC.kind === "other" ? `Tell them: ${OCC.label}.` : ""), link: GR };
      occTreat = { id: "treat", kind: "treat", title: `${OCC.word} treat`, land: F1.treat.land, dur: 20, priority: 4, who: ALL.slice(), icon: "🧁", occasion: OCC.tag,
        note: F1.treat.note, link: F1.treat.link };
    }

    /* ---- pick the stops ---- */
    const chosen = [];
    const take = i => { if (!chosen.includes(i)) chosen.push(i); };
    items.filter(i => must.has(i.id)).forEach(take);
    const fixedMin = 45 + 45 + (nap ? nap.dur : 0) + (occTask ? occTask.dur + occTreat.dur : 0) + lastlook.dur + (hop ? 15 : 0);
    const avail = Math.max(60, (leave - 30) - (arrive + 30) - fixedMin);
    const spent = () => chosen.reduce((a, i) => a + i.dur + 6, 0);
    const youngSoon = youngest < 4, youngKid = youngest < 7;
    // Equal priorities alternate between the parks on a hopping day. With one park this is the catalog order, as before.
    const rank = Object.create(null); const nIn = {}; items.forEach(i => { const pk = parkOf(i.land); nIn[pk] = (nIn[pk] || 0) + 1; rank[i.id] = nIn[pk]; });
    const pool = items.filter(i => !must.has(i.id) && i.priority >= 2 && i.kind !== "break"
      && !(i.minInches && i.minInches > shortest) && !(i.thrill && youngKid) && !(i.scary && youngSoon)
      && !(KIDDY.has(i.id) && !KIDS.length) && !(i.kind === "meet" && !KIDS.length))
      .sort((a, b) => b.priority - a.priority || rank[a.id] - rank[b.id] || CATALOG.indexOf(a) - CATALOG.indexOf(b));
    for (const i of pool) { if (spent() + i.dur + 6 > avail * 0.92) continue; take(i); }

    /* ---- when to hop ---- */
    let hopAt = null;
    if (hop) {
      const s0 = arrive + 30 + (occTask ? occTask.dur + 5 : 0), s1 = leave - 30 - lastlook.dur - 5;
      if (P.hop.at != null) hopAt = Math.max(s0, Math.min(s1, P.hop.at));
      else {
        // Split the free time (outside meals and the nap) in the same ratio as the stops picked in each park.
        const blocks = [[lunchAt, lunchAt + 45], [dinnerAt, dinnerAt + 45]]; if (nap) blocks.push([P.nap.start, P.nap.start + nap.dur]);
        const free = x => (x - s0) - blocks.reduce((a, [b0, b1]) => a + Math.max(0, Math.min(x, b1) - Math.max(s0, b0)), 0);
        const mins = pk => chosen.filter(i => parkOf(i.land) === pk).reduce((a, i) => a + i.dur + 6, 0) + (occTreat && pk === first ? occTreat.dur : 0);
        const m1 = mins(first), m2 = mins(second), share = m1 + m2 ? m1 / (m1 + m2) : 0.5;
        const target = free(s1) * share; let x = s0; while (x < s1 && free(x) < target) x += 5;
        x = Math.round(x / 15) * 15;
        const lo = s0 + 60, hi = s1 - 60;
        x = Math.max(lo, Math.min(hi, x));
        // Never in the middle of a meal or the nap: move to the end of it, or to its start if the end is too late in the day.
        for (let k = 0; k < 3; k++) blocks.forEach(([b0, b1]) => { if (x > b0 && x < b1) x = b1 <= hi ? b1 : Math.max(lo, b0); });
        hopAt = x;
      }
    }

    /* ---- put them in a walkable order ---- */
    let curPark = first;
    const events = [{ kind: "lunch", at: lunchAt }, { kind: "dinner", at: dinnerAt }];
    if (nap) events.push({ kind: "nap", at: P.nap.start });
    if (hop) events.push({ kind: "hop", at: hopAt });
    events.sort((a, b) => a.at - b.at || (a.kind === "hop" ? 1 : b.kind === "hop" ? -1 : 0));
    const out = [gate]; const early = [];
    if (tasks[0]) early.push(tasks[0]);
    if (occTask) early.push(occTask);
    early.forEach(x => out.push(x));
    let t = arrive + 30 + (occTask ? occTask.dur + 5 : 0), cur = early.length ? PARKS[first].entry : PARKS[first].gate;
    const left = chosen.slice(); if (occTreat) left.push(occTreat);
    const walk = (a, b) => (WALK[a] && isFinite(WALK[a][b]) ? WALK[a][b] : 6);
    const tour = () => PARKS[curPark].tour;
    const fits = (it, from, landFrom, limit) => {
      const s = from + walk(landFrom, it.land);
      if (it.window && (s < it.window[0] || s > it.window[1])) return false;
      return s + it.dur <= limit;
    };
    const fill = (limit, bias) => {
      for (;;) {
        let best = null, bs = Infinity;
        left.forEach(it => {
          if (parkOf(it.land) !== curPark || !fits(it, t, cur, limit)) return;
          const s = walk(cur, it.land) + (5 - (it.priority || 3)) * 0.9 - (must.has(it.id) ? 3 : 0) + (tour().indexOf(it.land) * bias);
          if (s < bs) { bs = s; best = it; }
        });
        if (!best) break;
        t += walk(cur, best.land) + best.dur; cur = best.land; out.push(best); left.splice(left.indexOf(best), 1);
      }
    };
    events.forEach((ev, n) => {
      fill(ev.at - 5, n === 0 ? 0.6 : 0.25);
      let it;
      if (ev.kind === "hop") it = hop;
      else if (ev.kind === "nap") it = Object.assign({}, nap, { land: cur }, FIXED[curPark].nap);
      else it = meal(ev.kind, curPark);
      out.push(it); t = Math.max(t + walk(cur, it.land), ev.at) + it.dur; cur = it.land;
      if (ev.kind === "hop") curPark = second;
    });
    // Stops still unplaced go after dinner, in tour order. Must-dos stay in the plan (the planner flags them if the day is too full); the rest become "add a stop" options.
    left.sort((a, b) => tour().indexOf(a.land) - tour().indexOf(b.land));
    fill(leave - 30 - lastlook.dur - 5, 0.1);
    left.filter(it => must.has(it.id) || it.id === "treat").forEach(it => {
      const h = out.indexOf(hop); // on a hopping day, a leftover from the first park goes before the hop, not across the Esplanade and back
      if (hop && h >= 0 && parkOf(it.land) === first) out.splice(h, 0, it); else out.push(it);
    });
    const dinnerAtIdx = out.findIndex(p => p.id === "dinner");
    const dinnerPark = dinnerAtIdx >= 0 && out[dinnerAtIdx].park ? out[dinnerAtIdx].park : last;
    tasks.slice(1).forEach((tk, n) => { tk.land = FIXED[dinnerPark].ll[n + 1]; out.splice(dinnerAtIdx < 0 ? out.length : dinnerAtIdx, 0, tk); }); // the later bookings show where you will be standing
    out.push(lastlook, exit);
    // Anything tall enough for the whole group but not chosen, and everything else, is addable later.
    const PLAN = out;
    const inPlan = new Set(PLAN.map(p => p.id));
    const BONUS = items.filter(i => !inPlan.has(i.id));

    /* ---- geo: only the parks in today's plan ---- */
    const G = {};
    items.forEach(i => { if (GEO[i.id]) G[i.id] = GEO[i.id]; });
    const pg = park => PARKS[park].geo;
    ["gate", "ll1", "occasion", "treat"].forEach(k => { G[k] = pg(first)[k]; });
    if (!hop) ["ll2", "ll3"].forEach(k => { G[k] = pg(first)[k]; }); // on a hopping day the app moves these bookings in time, so a fixed pin could sit in the wrong park
    ["lunch", "dinner"].forEach(k => { const m = PLAN.find(p => p.id === k); G[k] = pg(m && m.park ? m.park : first)[k]; });
    ["lastlook", "exit"].forEach(k => { G[k] = pg(last)[k]; });
    if (hop) G.hop = pg(second).hop;
    const napItem = PLAN.find(p => p.id === "nap");
    if (napItem) G.nap = LAND_GEO[napItem.land] || LAND_GEO[parkOf(napItem.land) === "dca" ? "bvs" : "hub"]; // the gate has no land pin; Disneyland keeps its old fallback
    const LG = {}; Object.keys(LAND_GEO).forEach(k => { if (dayParks.includes(parkOf(k))) LG[k] = LAND_GEO[k]; });

    const LL_ORDER = PLAN.concat(BONUS).filter(i => i.ll === true).sort((a, b) => b.priority - a.priority).slice(0, 6).map(i => i.id);

    return {
      PROFILE: P, DAY: P.date, START: arrive, GROUP: (P.groupName || "").trim(), OCC,
      IMG: {}, T, parkNow: K.parkNow, PEOPLE, ALL, ADULTS, KIDS, LANDS, WALK, PLAN, BONUS, LL_ORDER, DL, GEO: G, LAND_GEO: LG,
      MULTI: !!P.multiPass,
      PARKS: dayParks, FIRST: first, SECOND: second, HOP_AT: hopAt, START_LAND: PARKS[first].gate, PARK_INFO: PARKS, parkOf,
      PARK_LABEL: second ? `${PARKS[first].short} and ${PARKS[second].short}` : PARKS[first].name,
      DEFAULT_PREFS: { departure: leave, napOn: !!P.nap.on, lean: "balanced", heights: {} },
    };
  };

  function fmtT(m) { let h = Math.floor(m / 60) % 24, mm = m % 60; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + ":" + String(mm).padStart(2, "0") + " " + ap; }
  K.fmtT = fmtT;
})(window.DDK);
