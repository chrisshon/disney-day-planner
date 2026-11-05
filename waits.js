/*
  Live ride waits. On the day of the visit only, this asks ThemeParks.wiki (https://themeparks.wiki, free) how long each
  line is right now, and whether a ride is down or closed. app.js shows the answers and the planner uses the standby waits.
  It asks only for the parks in the day's plan (one feed per park, so two on a hopping day).
  Asks no more than once every 2 minutes, only while the page is on screen, and says nothing if a feed cannot be reached.
  Waits older than 15 minutes are treated as missing, park by park. Needs a credit link wherever waits show (see app.js).
*/
window.DDWait = (function () {
  const FEEDS = {
    disneyland: "https://api.themeparks.wiki/v1/entity/7340550b-c14d-4def-80bb-acdb51d49a66/live",
    dca: "https://api.themeparks.wiki/v1/entity/832fcd51-ea19-4e77-85c7-75d5843b127c/live",
  };
  const FEED = FEEDS.disneyland;
  // Stop id in catalog.js -> ThemeParks.wiki id. Disneyland first: the three character and splash stops (mickeyhouse, royalhall, centoonial) are not in the feed.
  const IDS = {
  minniehouse: "c02fb82d-0860-4e95-8c61-899fa594d20e",
  carrousel: "f7904912-3f08-4563-b99e-fd59f43cc9f2",
  dumbo: "cc980e8e-192f-48b6-848c-27784084e54b",
  smallworld: "3638ac09-9fce-4a43-8c79-8ebbe17afce2",
  peterpan: "c23af6ba-8515-406a-8a48-d0818ba0bfc9",
  caseyjr: "8e686e4c-f3db-4d9c-a185-2d54b1fa8899",
  storybook: "cb929138-d77a-4dd2-983c-f651bbd1bd92",
  madtea: "e0cfed11-96d7-40f3-907f-5cfed172592a",
  toad: "9d401ad3-49b2-469f-ac73-93eb429428fb",
  pinocchio: "90ee50d4-7cc9-4824-b29d-2aac801acc29",
  snowwhite: "4f0053e7-b8db-4833-b02f-35e1c91b4523",
  matterhorn: "faaa8be9-cc1e-4535-ac20-04a535654bd0",
  castlewalk: "90d5a091-478c-4df1-adfe-c605b4005013",
  runaway: "cd670bff-81d1-4f34-8676-7bafdf49220a",
  gadget: "59647168-d239-4161-8b24-92eb128e96fb",
  roger: "6ce9cdd1-0a43-459e-83cd-f4cace9cfa7b",
  duckpond: "ca32ef8a-ae0d-4c24-bf4f-e59192122e01",
  buzz: "88197808-3c56-4198-a5a4-6066541251cf",
  autopia: "1da85181-bf0f-4ccc-b98e-243142f7347b",
  startours: "cc718d11-fa15-44ee-87d0-ded989ad61bc",
  space: "9167db1d-e5e7-46da-a07f-ae30a87bc4c4",
  astro: "6c225598-91c9-44a3-95e2-7c423475db61",
  nemo: "64d44aaa-6857-4693-b24b-bcff6c6dcfa1",
  monorail: "56d0bd6d-5106-4420-8f60-0005475c04c3",
  jungle: "1b83fda8-d60e-48e4-9a3d-90ddcbcd1001",
  tiki: "106c1e5a-a5e7-42d7-96ab-bc100d8faf71",
  treehouse: "e27b1db8-9ec9-4f8b-9ca6-fd6377de66ee",
  indy: "2aedc657-1ee2-4545-a1ce-14753f28cc66",
  pirates: "82aeb29b-504a-416f-b13f-f41fa5b766aa",
  mansion: "ff52cb64-c1d5-4feb-9d43-5dbd429bac81",
  bigthunder: "0de1413a-73ee-46cf-af2e-c491cc7c7d3b",
  marktwain: "6c30d5b0-8c0a-406f-9258-0b6c55d4a5e4",
  tomsawyer: "07952343-3498-404b-8337-734de9a185c1",
  shootin: "835deb74-de54-4d7f-9dc4-dacab90fcb60",
  pooh: "52a8ef64-d54c-4974-883f-027c3026e3f1",
  tiana: "a9076acd-7630-4bad-a8da-e6bd689ddcac",
  falcon: "b2c2549c-e9da-4fdd-98ea-1dcff596fed7",
  rise: "34b1d70f-11c4-42df-935e-d5582c9f1a8e",
  railroad: "e2d460e9-2bef-4613-b126-092ab7cb37e5",
  msvehicles: "bcfd1e17-3eab-4203-b597-6257a257d427",
  cinema: "f5bb0d14-7eee-4ede-9230-eb256ce3664c",
  lincoln: "1b23667a-d8fb-436d-8952-c3e3f2e56d13",
  waltlife: "05b17c11-fd4c-4b85-ab45-3e269dc56559",
  // Disney California Adventure Park (every California Adventure stop in catalog.js is in its feed)
  dcapals: "4c570f5a-c5da-4388-9804-dd56123d18ce",
  annaelsa: "29be8df3-70fa-478b-a772-098cf643936c",
  monsters: "40524fba-5d84-49e7-9204-f493dbe2d5a4",
  philharmagic: "8f586a2f-cef5-46d3-b822-fd622c4e9e33",
  turtletalk: "7561bcd8-18ea-4e3f-89d5-c905b7ba3d42",
  animacademy: "d2aa0987-49a2-45dc-a635-3a8bf7401230",
  sorcerer: "44c1f655-25d3-440c-b1a8-db736a12b105",
  webslingers: "2295351d-ce6b-4c04-92d5-5b416372c5b5",
  guardians: "b7678dab-5544-48d5-8fdc-c1a0127cfbcd",
  rsr: "c60c768b-3461-465c-8f4f-b44b087506fc",
  luigis: "7a09a2f0-e226-4f3e-86f8-2598ab67ec44",
  mater: "46097afe-a1ea-4807-93d3-14d14f36e55f",
  bakery: "eb77ee1f-3207-44fd-acfc-d7bc18602007",
  soarin: "77f205a4-d482-4d91-a5ff-71e54a086ad2",
  grizzly: "b1d285a7-2444-4a7c-b7bb-d2d4d6428a85",
  redwood: "c9803366-6f37-4406-82af-7692357e3ca9",
  mermaid: "e1fbc7a1-2cd1-4282-b373-ac11d9d9d38a",
  sillyswings: "4f5b28d0-b78e-482b-8e2e-1f90756d6220",
  zephyr: "10a5fc6f-5ad3-414b-9bdd-e6bae097b6ad",
  jellyfish: "c8a4b7b1-c1b2-4dfe-b73c-4e834b4a73db",
  goofysky: "f44a5072-3cda-4c7c-8574-33ad09d16cca",
  tsmm: "86ab3069-110d-49c5-a7e7-29ddf28695a6",
  incredi: "5d07a2b1-49ca-4de7-9d32-6d08edf69b08",
  jessie: "388ad3f1-5cf5-4a9d-8d0e-6dfb817d7822",
  whirlwind: "6d876f4c-c3ff-4ae3-a2d8-d4b831e1039b",
  palaround: "4ca6cdbf-4c5f-45bf-b0dc-db83393ec208",
  palswing: "528016ef-db24-47fa-a0f2-b6d26d61e29f",
  pixargames: "1d24dd7a-372b-4195-8ad0-ba9679d72b08",
  };
  const EVERY = 2 * 60 * 1000, MAX_AGE = 15 * 60 * 1000, TIMEOUT = 10000;
  const byEntity = {}; Object.keys(IDS).forEach(k => { byEntity[IDS[k]] = k; });
  // Per park: the answers, when they were fetched, and the newest update in that park's feed.
  const parks = {};
  let lastTry = 0, busy = false;
  let hooks = { enabled: () => false, changed: () => { }, parks: ["disneyland"], parkOf: () => "disneyland" };

  // One answer per stop: its status, the standby wait in minutes (or null), and the Lightning Lane return window as [start, end] in ms (or null).
  function parse(json) {
    const list = json && Array.isArray(json.liveData) ? json.liveData : null;
    if (!list) return null;
    const out = {}; let latest = 0;
    list.forEach(e => {
      if (!e || typeof e !== "object") return;
      const t = Date.parse(e.lastUpdated || "") || 0; if (t > latest) latest = t;
      const id = byEntity[e.id]; if (!id) return;
      const q = e.queue && typeof e.queue === "object" ? e.queue : {};
      const wait = q.STANDBY && Number.isFinite(q.STANDBY.waitTime) ? Math.max(0, Math.round(q.STANDBY.waitTime)) : null;
      const r = q.RETURN_TIME; let ret = null;
      if (r && r.state === "AVAILABLE") { const a = Date.parse(r.returnStart || ""), b = Date.parse(r.returnEnd || ""); if (isFinite(a)) ret = [a, isFinite(b) ? b : null]; }
      out[id] = { status: typeof e.status === "string" ? e.status : "", wait, ret };
    });
    return { out, latest };
  }

  async function one(park) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null, timer = setTimeout(() => ctl && ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(FEEDS[park], { signal: ctl ? ctl.signal : undefined });
      if (!r.ok) throw new Error(r.status);
      const p = parse(await r.json()); if (!p) throw new Error("unreadable");
      parks[park] = { table: p.out, newest: p.latest, fetchedAt: Date.now() };
      return true;
    } catch (e) { return false; } /* offline or the feed is down: show nothing for that park */
    finally { clearTimeout(timer); }
  }
  async function refresh() {
    if (busy || !hooks.enabled() || document.visibilityState !== "visible") return;
    if (Date.now() - lastTry < EVERY - 5000) return; // never faster than every 2 minutes, however often the page is focused
    busy = true; lastTry = Date.now();
    try {
      const got = await Promise.all((hooks.parks || ["disneyland"]).filter(k => FEEDS[k]).map(one));
      if (got.some(Boolean)) hooks.changed();
    } finally { busy = false; }
  }

  // The feed's own "last updated" times only move when a line changes, so freshness is judged on the newest update anywhere in that park.
  const fresh = s => !!s && Date.now() - s.fetchedAt <= MAX_AGE && Date.now() - s.newest <= MAX_AGE;
  const get = id => { if (!hooks.enabled()) return null; const s = parks[hooks.parkOf(id)]; return (fresh(s) && s.table[id]) || null; };
  const standby = id => { const e = get(id); return e && e.status === "OPERATING" && e.wait != null ? e.wait : null; };

  function init(h) {
    hooks = Object.assign({ parks: ["disneyland"], parkOf: () => "disneyland" }, h);
    setInterval(refresh, EVERY);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    refresh();
  }
  return { FEED, FEEDS, IDS, init, refresh, get, standby };
})();
