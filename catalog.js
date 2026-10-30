/*
  Park catalog for Disneyland Park (Anaheim). Everything here is general: no family, no date.
  The setup flow (setup.js) and the planner (planner.js) turn this into one day for one group.

  Facts such as height rules and Lightning Lane Multi Pass eligibility were checked against
  disneyland.com in October 2026. They change, so the app tells people to confirm in the official app.
  Walkway and pin coordinates come from OpenStreetMap (c) OpenStreetMap contributors, ODbL.
*/
window.DDK = (function () {
  const T = (h, m = 0) => h * 60 + m;

  // Lands and walking minutes between neighbours.
  const LANDS = {
    car: { name: "Car", color: "#4a5568" },
    gate: { name: "Esplanade", color: "#4a5568" },
    ms: { name: "Main Street", color: "#c53030" },
    hub: { name: "Castle Hub", color: "#b7791f" },
    fl: { name: "Fantasyland", color: "#6b46c1" },
    ff: { name: "Fantasy Faire", color: "#b83280" },
    tt: { name: "Toontown", color: "#dd6b20" },
    tl: { name: "Tomorrowland", color: "#2b6cb0" },
    al: { name: "Adventureland", color: "#2f855a" },
    nos: { name: "New Orleans Sq", color: "#553c9a" },
    fr: { name: "Frontierland", color: "#975a16" },
    cc: { name: "Bayou Country", color: "#2f855a" },
    ge: { name: "Galaxy's Edge", color: "#4a5568" },
  };
  const EDGES = [
    ["car", "gate", 0], ["gate", "ms", 5], ["ms", "hub", 4], ["hub", "fl", 3], ["hub", "ff", 3], ["ff", "fl", 3],
    ["fl", "tt", 6], ["hub", "tl", 3], ["fl", "tl", 5], ["hub", "al", 3], ["al", "nos", 4], ["hub", "fr", 4],
    ["fr", "nos", 3], ["tt", "tl", 10], ["fl", "fr", 7], ["al", "fr", 3],
    ["nos", "cc", 3], ["fr", "cc", 4], ["cc", "ge", 4], ["fr", "ge", 6], ["fl", "ge", 8],
  ];
  const WALK = {};
  Object.keys(LANDS).forEach(a => { WALK[a] = {}; Object.keys(LANDS).forEach(b => WALK[a][b] = a === b ? 0 : Infinity); });
  EDGES.forEach(([a, b, w]) => { WALK[a][b] = w; WALK[b][a] = w; });
  Object.keys(LANDS).forEach(k => Object.keys(LANDS).forEach(i => Object.keys(LANDS).forEach(j => {
    if (WALK[i][k] + WALK[k][j] < WALK[i][j]) WALK[i][j] = WALK[i][k] + WALK[k][j];
  })));

  const DL = "https://disneyland.disney.go.com";
  const att = s => `${DL}/attractions/disneyland/${s}/`;
  const ent = s => `${DL}/entertainment/disneyland/${s}/`;
  const dine = s => `${DL}/dining/disneyland/${s}/`;

  /*
    One entry per stop someone can add to the day.
    kind: ride | show | meet | break
    priority: 1 (drop first) to 5 (never drop). Higher priority stops are picked first and dropped last.
    minInches: height rule. ll: true if Lightning Lane Multi Pass covers it (only used when the group has the pass).
    thrill: fast or intense, left out of the default day when a young child is coming.
    scary: dark or loud, left out of the default day when a toddler is coming.
    window: [open, close] in minutes, only when the stop has set hours.
    times: list of showtimes in minutes. Empty in this catalog, because showtimes change daily.
           (Add some here, or ask Claude Code to, to make the planner snap a show to its times.)
  */
  const CATALOG = [
    // Characters
    { id: "mickeyhouse", kind: "meet", title: "Meet Mickey at his house", land: "tt", dur: 35, priority: 4, icon: "🏠", link: att("mickeys-house"),
      note: "Walk through the house to the Movie Barn to meet Mickey. Lines are shortest early and late in the day." },
    { id: "minniehouse", kind: "meet", title: "Minnie's House and Goofy's play yard", land: "tt", dur: 20, priority: 2, icon: "🎀", link: att("minnies-house"),
      note: "Let the kids run around. Minnie is often home." },
    { id: "royalhall", kind: "meet", title: "Princesses at Royal Hall", land: "ff", dur: 40, priority: 4, icon: "👑", window: [T(10, 0), T(17, 0)], link: ent("character-meet-princesses-royal-hall"),
      note: "Opens around 10:00. Arriving soon after it opens beats a long wait later. Hours vary, so confirm in the Disneyland app." },

    // Fantasyland and Fantasy Faire
    { id: "carrousel", kind: "ride", title: "King Arthur Carrousel", land: "fl", dur: 15, priority: 3, icon: "🎠", link: att("king-arthur-carrousel"),
      note: "Any height. Little ones can ride in a lap. Quick and gentle." },
    { id: "dumbo", kind: "ride", title: "Dumbo the Flying Elephant", land: "fl", dur: 20, priority: 3, icon: "🐘", link: att("dumbo-the-flying-elephant"),
      note: "Any height. Two per elephant, and the rider controls how high it flies." },
    { id: "smallworld", kind: "ride", title: "it's a small world", land: "fl", dur: 25, priority: 4, icon: "🌎", ll: true, link: att("its-a-small-world"),
      note: "Any height. A calm boat ride, good when everyone needs to sit and cool off." },
    { id: "peterpan", kind: "ride", title: "Peter Pan's Flight", land: "fl", dur: 35, priority: 2, icon: "🧚", link: att("peter-pans-flight"),
      note: "Any height. Standby only and the line is long all day. Try it in the last hour." },
    { id: "caseyjr", kind: "ride", title: "Casey Jr. Circus Train", land: "fl", dur: 15, priority: 2, icon: "🚂", link: att("casey-jr-circus-train"),
      note: "Any height, outdoors, gentle." },
    { id: "storybook", kind: "ride", title: "Storybook Land Canal Boats", land: "fl", dur: 20, priority: 2, icon: "⛵", link: att("storybook-land-canal-boats"),
      note: "Any height. A slow boat through miniature villages." },
    { id: "madtea", kind: "ride", title: "Mad Tea Party", land: "fl", dur: 15, priority: 2, icon: "🫖", link: att("mad-tea-party"),
      note: "Any height. Spinning teacups, and you control the spin." },
    { id: "toad", kind: "ride", title: "Mr. Toad's Wild Ride", land: "fl", dur: 20, priority: 2, icon: "🚗", scary: true, link: att("mr-toads-wild-ride"),
      note: "Any height. A dark ride that is loud and a little wild at the end." },
    { id: "pinocchio", kind: "ride", title: "Pinocchio's Daring Journey", land: "fl", dur: 20, priority: 2, icon: "🪵", scary: true, link: att("pinocchios-daring-journey"),
      note: "Any height. A dark ride with a couple of scary moments." },
    { id: "snowwhite", kind: "ride", title: "Snow White's Enchanted Wish", land: "fl", dur: 20, priority: 2, icon: "🍎", scary: true, link: att("snow-whites-enchanted-wish"),
      note: "Any height. A dark ride, gentler than it used to be." },
    { id: "matterhorn", kind: "ride", title: "Matterhorn Bobsleds", land: "fl", dur: 25, priority: 2, icon: "🏔️", ll: true, minInches: 42, thrill: true, link: att("matterhorn-bobsleds"),
      note: "42 inches. A fast coaster in the dark. Riders who are too short can use Rider Switch." },
    { id: "castlewalk", kind: "ride", title: "Sleeping Beauty Castle Walkthrough", land: "hub", dur: 15, priority: 3, icon: "🏰", link: att("sleeping-beauty-castle-walkthrough"),
      note: "Any height. Storybook scenes inside the castle. Stairs, so no strollers." },

    // Toontown
    { id: "runaway", kind: "ride", title: "Mickey & Minnie's Runaway Railway", land: "tt", dur: 40, priority: 4, icon: "🎞️", ll: true, link: att("mickey-minnies-runaway-railway"),
      note: "Any height. A ride through a cartoon. Check the posted wait in the app and skip it if the line is over 45 minutes." },
    { id: "gadget", kind: "ride", title: "Chip 'n' Dale's GADGETcoaster", land: "tt", dur: 20, priority: 3, icon: "🎢", minInches: 35, link: att("chip-n-dales-gadget-coaster"),
      note: "35 inches. A one-minute starter coaster." },
    { id: "roger", kind: "ride", title: "Roger Rabbit's Car Toon Spin", land: "tt", dur: 25, priority: 2, icon: "🥕", ll: true, scary: true, link: att("roger-rabbits-car-toon-spin"),
      note: "Any height, but dark and spinny. Skip it for anyone who got dizzy on the teacups." },
    { id: "centoonial", kind: "break", title: "CenTOONial Park splash fountain", land: "tt", dur: 15, priority: 1, icon: "💦", link: att("centoonial-park"),
      note: "Toontown entrance. Water play. Bring a change of clothes if the kids go in." },
    { id: "duckpond", kind: "break", title: "Donald's Duck Pond", land: "tt", dur: 15, priority: 1, icon: "🦆", link: att("donalds-duck-pond"),
      note: "Toontown water play area for little ones." },

    // Tomorrowland
    { id: "buzz", kind: "ride", title: "Buzz Lightyear Astro Blasters", land: "tl", dur: 25, priority: 4, icon: "🚀", ll: true, link: att("buzz-lightyear-astro-blasters"),
      note: "Any height. Everyone gets a blaster, and you can spin the car for points." },
    { id: "autopia", kind: "ride", title: "Autopia", land: "tl", dur: 25, priority: 3, icon: "🏎️", ll: true, minInches: 32, link: att("autopia"),
      note: "32 inches to ride with an adult. Kids love steering." },
    { id: "startours", kind: "ride", title: "Star Tours", land: "tl", dur: 25, priority: 2, icon: "🛸", ll: true, minInches: 40, thrill: true, link: att("star-tours"),
      note: "40 inches. A motion simulator that can be intense for young kids." },
    { id: "space", kind: "ride", title: "Space Mountain", land: "tl", dur: 30, priority: 2, icon: "🌌", ll: true, minInches: 40, thrill: true, link: att("space-mountain"),
      note: "40 inches. A fast coaster in the dark. Riders who are too short can use Rider Switch." },
    { id: "astro", kind: "ride", title: "Astro Orbitor", land: "tl", dur: 20, priority: 2, icon: "🪐", link: att("astro-orbitor"),
      note: "Any height. Rockets you steer up and down. The line moves slowly." },
    { id: "nemo", kind: "ride", title: "Finding Nemo Submarine Voyage", land: "tl", dur: 35, priority: 1, icon: "🐠", link: att("finding-nemo-submarine-voyage"),
      note: "Any height. An enclosed sub with a long line and no strollers. Only if the kids ask." },
    { id: "monorail", kind: "ride", title: "Disneyland Monorail", land: "tl", dur: 25, priority: 2, icon: "🚝", link: att("disneyland-monorail"),
      note: "Any height. A round trip to Downtown Disney and back without getting off. A good rest option." },

    // Adventureland, New Orleans Square, Frontierland, Bayou Country, Galaxy's Edge
    { id: "jungle", kind: "ride", title: "Jungle Cruise", land: "al", dur: 30, priority: 3, icon: "🐊", link: att("jungle-cruise"),
      note: "Any height. A boat ride with a skipper telling jokes. Strollers are fine." },
    { id: "tiki", kind: "show", title: "Enchanted Tiki Room", land: "al", dur: 25, priority: 2, icon: "🦜", link: att("enchanted-tiki-room"),
      note: "Seated, air-conditioned, singing birds. A good rest stop, and the Dole Whip stand is right outside." },
    { id: "treehouse", kind: "ride", title: "Adventureland Treehouse", land: "al", dur: 20, priority: 1, icon: "🌳", link: att("adventureland-treehouse"),
      note: "Any height. A walk-through with lots of stairs, so no strollers." },
    { id: "indy", kind: "ride", title: "Indiana Jones Adventure", land: "al", dur: 30, priority: 2, icon: "🗿", ll: true, minInches: 46, thrill: true, link: att("indiana-jones-adventure"),
      note: "46 inches. A rough, fast jeep ride. Riders who are too short can use Rider Switch." },
    { id: "pirates", kind: "ride", title: "Pirates of the Caribbean", land: "nos", dur: 25, priority: 3, icon: "🏴‍☠️", scary: true, link: att("pirates-of-the-caribbean"),
      note: "Any height. A dark boat ride with two small drops." },
    { id: "mansion", kind: "ride", title: "Haunted Mansion", land: "nos", dur: 25, priority: 3, icon: "👻", ll: true, scary: true, link: att("haunted-mansion-holiday"),
      note: "Any height, but dark and spooky. In the fall and winter it has a holiday theme, so it can be a longer wait." },
    { id: "bigthunder", kind: "ride", title: "Big Thunder Mountain", land: "fr", dur: 25, priority: 3, icon: "⛏️", ll: true, minInches: 40, thrill: true, link: att("big-thunder-mountain-railroad"),
      note: "40 inches. A mine-train coaster. Riders who are too short can use Rider Switch." },
    { id: "marktwain", kind: "ride", title: "Mark Twain Riverboat", land: "fr", dur: 25, priority: 2, icon: "🚢", link: att("mark-twain-riverboat"),
      note: "Any height. The stroller stays with you. A calm rest option." },
    { id: "tomsawyer", kind: "ride", title: "Pirate's Lair on Tom Sawyer Island", land: "fr", dur: 45, priority: 1, icon: "🏝️", link: att("pirates-lair-on-tom-sawyer-island"),
      note: "Take a raft across the river, then explore caves and bridges. Closes earlier than the park, so check hours." },
    { id: "shootin", kind: "ride", title: "Frontierland Shootin' Exposition", land: "fr", dur: 10, priority: 1, icon: "🎯", link: att("frontierland-shootin-exposition"),
      note: "Arcade-style rifles. A quick stop." },
    { id: "pooh", kind: "ride", title: "The Many Adventures of Winnie the Pooh", land: "cc", dur: 20, priority: 2, icon: "🍯", link: att("many-adventures-of-winnie-the-pooh"),
      note: "Gentle, any height. In Bayou Country, a short walk from the Haunted Mansion." },
    { id: "tiana", kind: "ride", title: "Tiana's Bayou Adventure", land: "cc", dur: 30, priority: 2, icon: "🎷", ll: true, minInches: 40, thrill: true, link: att("tianas-bayou-adventure"),
      note: "40 inches. A big drop at the end, and you get wet. Riders who are too short can use Rider Switch." },
    { id: "falcon", kind: "ride", title: "Millennium Falcon: Smugglers Run", land: "ge", dur: 30, priority: 2, icon: "🛰️", ll: true, minInches: 38, thrill: true, link: att("millennium-falcon-smugglers-run"),
      note: "38 inches. Fly the ship with six to a cockpit. It is a motion simulator." },
    { id: "rise", kind: "ride", title: "Rise of the Resistance", land: "ge", dur: 45, priority: 2, icon: "⭐", minInches: 40, thrill: true, link: att("star-wars-rise-of-the-resistance"),
      note: "40 inches. Not covered by Multi Pass (paid single pass or standby). Intense for young kids." },

    // Main Street and the hub
    { id: "railroad", kind: "ride", title: "Disneyland Railroad", land: "ms", dur: 30, priority: 3, icon: "🚂", link: att("disneyland-railroad"),
      note: "Any height. A full loop takes about 20 minutes with stops at Main Street, New Orleans Square, Toontown and Tomorrowland. A good way to rest." },
    { id: "msvehicles", kind: "ride", title: "Main Street Vehicles", land: "ms", dur: 10, priority: 1, icon: "🚒", link: att("main-street-vehicles"),
      note: "A horse-drawn streetcar, fire engine and omnibus. Hours are shorter than the park, so check the app." },
    { id: "cinema", kind: "show", title: "Main Street Cinema", land: "ms", dur: 10, priority: 1, icon: "🎬", link: att("main-street-cinema"),
      note: "Old cartoons on a loop. Quick, cool, standing room." },
    { id: "lincoln", kind: "show", title: "Disneyland Story with Mr. Lincoln", land: "ms", dur: 25, priority: 1, icon: "🎩", link: att("disneyland-story"),
      note: "In the Opera House, seated and air-conditioned. Hours are limited, so check the app." },
    { id: "waltlife", kind: "show", title: "Walt Disney, A Magical Life", land: "ms", dur: 25, priority: 1, icon: "🎭", link: att("walt-disney-a-magical-life"),
      note: "In the Opera House, seated. Hours are limited, so check the app." },
  ];

  // Pin coordinates (lat, lon). From OpenStreetMap; a few placed by hand from the park map.
  const GEO = {
    gate: [33.8094, -117.9191], exit: [33.8092, -117.9189],
    ll1: [33.8103, -117.9187], ll2: [33.8153, -117.9186], ll3: [33.8123, -117.9174], occasion: [33.81023, -117.91947],
    royalhall: [33.81264, -117.91957],
    carrousel: [33.81339, -117.91896], dumbo: [33.81367, -117.91890], peterpan: [33.81310, -117.91883],
    caseyjr: [33.81372, -117.91924], storybook: [33.81371, -117.91855], pooh: [33.8124, -117.9231],
    smallworld: [33.81468, -117.91775],
    mickeyhouse: [33.81554, -117.91936], runaway: [33.81595, -117.91873],
    lunch: [33.81554, -117.91874], minniehouse: [33.81557, -117.91902], gadget: [33.81522, -117.91949], roger: [33.81531, -117.91802],
    lastlook: [33.8106, -117.9190], dinner: [33.81159, -117.91833], treat: [33.81166, -117.91937],
    buzz: [33.81239, -117.91772], autopia: [33.81265, -117.91653], astro: [33.81209, -117.91828], startours: [33.81169, -117.91771], nemo: [33.81283, -117.91718],
    jungle: [33.81140, -117.92005], tiki: [33.8116, -117.9196], pirates: [33.81080, -117.92148], mansion: [33.8117, -117.9221],
    bigthunder: [33.81267, -117.92036], marktwain: [33.81224, -117.92055],
    madtea: [33.81348, -117.91828], toad: [33.81331, -117.91872], pinocchio: [33.81335, -117.91919], snowwhite: [33.81309, -117.9191],
    castlewalk: [33.81285, -117.91912], monorail: [33.81282, -117.91667], treehouse: [33.81126, -117.92054], tomsawyer: [33.81168, -117.92155],
    msvehicles: [33.8103, -117.9188], cinema: [33.81071, -117.91885], lincoln: [33.81026, -117.91834], waltlife: [33.81026, -117.91834],
    shootin: [33.8123, -117.9198], centoonial: [33.8150, -117.9187], duckpond: [33.81522, -117.91911], railroad: [33.8100, -117.9188],
    space: [33.81097, -117.9175], tiana: [33.81192, -117.92284], falcon: [33.81521, -117.92138], rise: [33.81439, -117.92272],
    matterhorn: [33.81307, -117.91785], indy: [33.8103, -117.92117],
  };
  const LAND_GEO = { cc: [33.8121, -117.9226], ge: [33.8148, -117.9225], ms: [33.8107, -117.9190], hub: [33.8121, -117.9190], fl: [33.8139, -117.9186], ff: [33.8127, -117.9199], tt: [33.8156, -117.9189], tl: [33.8124, -117.9170], al: [33.8112, -117.9204], nos: [33.8109, -117.9214], fr: [33.8129, -117.9207] };

  // Typical height in inches by age, used only when a child's height is not entered.
  const HEIGHT_BY_AGE = [24, 30, 34, 37, 40, 43, 46, 48, 51, 53, 55, 58, 60, 62, 64, 65, 66, 67];

  return { T, LANDS, WALK, DL, att, ent, dine, CATALOG, GEO, LAND_GEO, HEIGHT_BY_AGE };
})();
