/*
  Park catalog for the Disneyland Resort (Anaheim): Disneyland Park and Disney California Adventure Park.
  Everything here is general: no family, no date. The setup flow (setup.js) and the planner (planner.js)
  turn this into one day for one group, in one park or hopping from one park to the other.

  Facts such as height rules and Lightning Lane Multi Pass eligibility were checked against disneyland.com:
  Disneyland Park in October 2026, California Adventure on 2026-11-05. They change, so the app tells people
  to confirm in the official app. Walkway and pin coordinates come from OpenStreetMap (c) OpenStreetMap
  contributors, ODbL; California Adventure pins also use ThemeParks.wiki locations.
*/
window.DDK = (function () {
  const T = (h, m = 0) => h * 60 + m;

  // Lands and walking minutes between neighbours.
  const LANDS = {
    car: { name: "Car", color: "#4a5568", park: "disneyland" },
    gate: { name: "Esplanade", color: "#4a5568", park: "disneyland" },
    ms: { name: "Main Street", color: "#c53030", park: "disneyland" },
    hub: { name: "Castle Hub", color: "#b7791f", park: "disneyland" },
    fl: { name: "Fantasyland", color: "#6b46c1", park: "disneyland" },
    ff: { name: "Fantasy Faire", color: "#b83280", park: "disneyland" },
    tt: { name: "Toontown", color: "#dd6b20", park: "disneyland" },
    tl: { name: "Tomorrowland", color: "#2b6cb0", park: "disneyland" },
    al: { name: "Adventureland", color: "#2f855a", park: "disneyland" },
    nos: { name: "New Orleans Sq", color: "#553c9a", park: "disneyland" },
    fr: { name: "Frontierland", color: "#975a16", park: "disneyland" },
    cc: { name: "Bayou Country", color: "#2f855a", park: "disneyland" },
    ge: { name: "Galaxy's Edge", color: "#4a5568", park: "disneyland" },
    // Disney California Adventure Park
    cgate: { name: "California Adventure gate", color: "#4a5568", park: "dca" },
    bvs: { name: "Buena Vista Street", color: "#b7791f", park: "dca" },
    hw: { name: "Hollywood Land", color: "#6b46c1", park: "dca" },
    ac: { name: "Avengers Campus", color: "#c53030", park: "dca" },
    cl: { name: "Cars Land", color: "#dd6b20", park: "dca" },
    sfs: { name: "San Fransokyo Square", color: "#b83280", park: "dca" },
    gp: { name: "Grizzly Peak", color: "#2f855a", park: "dca" },
    pg: { name: "Paradise Gardens Park", color: "#2b6cb0", park: "dca" },
    pp: { name: "Pixar Pier", color: "#2fa7b8", park: "dca" },
  };
  const EDGES = [
    ["car", "gate", 0], ["gate", "ms", 5], ["ms", "hub", 4], ["hub", "fl", 3], ["hub", "ff", 3], ["ff", "fl", 3],
    ["fl", "tt", 6], ["hub", "tl", 3], ["fl", "tl", 5], ["hub", "al", 3], ["al", "nos", 4], ["hub", "fr", 4],
    ["fr", "nos", 3], ["tt", "tl", 10], ["fl", "fr", 7], ["al", "fr", 3],
    ["nos", "cc", 3], ["fr", "cc", 4], ["cc", "ge", 4], ["fr", "ge", 6], ["fl", "ge", 8],
    // California Adventure. Minutes come from the OpenStreetMap walkway distances between lands at a crowded-park pace.
    ["cgate", "bvs", 3], ["bvs", "hw", 5], ["bvs", "gp", 6], ["bvs", "sfs", 6], ["bvs", "ac", 6], ["hw", "ac", 5], ["ac", "cl", 4],
    ["cl", "sfs", 4], ["sfs", "gp", 7], ["sfs", "pg", 6], ["gp", "pg", 8], ["pg", "pp", 6], ["sfs", "pp", 7],
    // The two gates face each other across the Esplanade (about 125 m). Security is before the Esplanade, so hopping is a walk plus a ticket scan.
    ["gate", "cgate", 6],
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
  const catt = s => `${DL}/attractions/disney-california-adventure/${s}/`;
  const cent = s => `${DL}/entertainment/disney-california-adventure/${s}/`;
  const cdine = s => `${DL}/dining/disney-california-adventure/${s}/`;

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

    /* ---------- Disney California Adventure Park (checked on disneyland.com 2026-11-05) ---------- */
    // Buena Vista Street and Hollywood Land
    { id: "dcapals", kind: "meet", title: "Meet Disney pals on Buena Vista Street", land: "bvs", dur: 25, priority: 3, icon: "🐭", link: cent("disney-pals-on-buena-vista-street"),
      note: "Characters like Mickey, Minnie and Goofy greet guests on Buena Vista Street. Times vary, so check the Disneyland app." },
    { id: "annaelsa", kind: "meet", title: "Anna and Elsa's Royal Welcome", land: "hw", dur: 40, priority: 4, icon: "❄️", link: cent("character-meet-anna-and-elsa-frozen"),
      note: "Meet the sisters from Frozen face to face. Times vary, so check the Disneyland app." },
    { id: "monsters", kind: "ride", title: "Monsters, Inc. Mike & Sulley to the Rescue!", land: "hw", dur: 30, priority: 4, icon: "👁️", ll: true, link: catt("monsters-inc"),
      note: "Any height. Ride with Mike and Sulley through Monstropolis to get Boo back to her bedroom." },
    { id: "philharmagic", kind: "show", title: "Mickey's PhilharMagic", land: "hw", dur: 25, priority: 3, icon: "🎺", link: catt("mickeys-philharmagic"),
      note: "Any height. A 3D concert movie with many Disney characters, in the Sunset Showcase Theater." },
    { id: "turtletalk", kind: "show", title: "Turtle Talk with Crush", land: "hw", dur: 25, priority: 3, icon: "🐢", link: catt("turtle-talk-with-crush"),
      note: "Any height. Kids chat live with Crush the sea turtle from Finding Nemo and Finding Dory." },
    { id: "animacademy", kind: "show", title: "Animation Academy", land: "hw", dur: 25, priority: 2, icon: "✏️", link: catt("animation-academy"),
      note: "Any height. A hands-on drawing session with a Disney artist." },
    { id: "sorcerer", kind: "show", title: "Sorcerer's Workshop", land: "hw", dur: 15, priority: 1, icon: "🪄", link: catt("sorcerers-workshop"),
      note: "Any height. See how Disney animators bring characters to life." },

    // Avengers Campus
    { id: "webslingers", kind: "ride", title: "WEB SLINGERS: A Spider-Man Adventure", land: "ac", dur: 35, priority: 4, icon: "🕷️", ll: true, link: catt("web-slingers-spider-man-adventure"),
      note: "Any height. Help Spider-Man round up runaway Spider-Bots." },
    { id: "guardians", kind: "ride", title: "Guardians of the Galaxy: Mission BREAKOUT!", land: "ac", dur: 30, priority: 2, icon: "🚀", ll: true, minInches: 40, thrill: true, scary: true, link: catt("guardians-galaxy-mission-breakout"),
      note: "40 inches. A ride with free-fall drops. Riders who are too short can use Rider Switch." },

    // Cars Land
    { id: "rsr", kind: "ride", title: "Radiator Springs Racers", land: "cl", dur: 60, priority: 3, icon: "🏁", minInches: 40, thrill: true, link: catt("radiator-springs-racers"),
      note: "40 inches. A car race through the town from Cars. Not covered by Multi Pass (paid single pass, single rider line or standby). Riders who are too short can use Rider Switch." },
    { id: "luigis", kind: "ride", title: "Luigi's Rollickin' Roadsters", land: "cl", dur: 20, priority: 3, icon: "🚙", minInches: 32, link: catt("luigis-rollickin-roadsters"),
      note: "32 inches. Little cars spin around Luigi's lot to Italian tunes." },
    { id: "mater", kind: "ride", title: "Mater's Junkyard Jamboree", land: "cl", dur: 20, priority: 3, icon: "🚜", minInches: 32, link: catt("maters-junkyard-jamboree"),
      note: "32 inches. Little tractors spin you around the junkyard." },

    // San Fransokyo Square and Grizzly Peak
    { id: "bakery", kind: "show", title: "The Bakery Tour", land: "sfs", dur: 10, priority: 1, icon: "🥖", link: catt("bakery-tour"),
      note: "Any height. A short walk through a real sourdough bakery." },
    { id: "soarin", kind: "ride", title: "Soarin' Across America", land: "gp", dur: 35, priority: 3, icon: "🦅", ll: true, minInches: 40, link: catt("soarin-across-america"),
      note: "40 inches. A simulated flight from coast to coast. Riders who are too short can use Rider Switch." },
    { id: "grizzly", kind: "ride", title: "Grizzly River Run", land: "gp", dur: 30, priority: 2, icon: "🛶", ll: true, minInches: 42, thrill: true, link: catt("grizzly-river-run"),
      note: "42 inches. A whitewater raft ride, and Disney warns you will get wet. Riders who are too short can use Rider Switch." },
    { id: "redwood", kind: "break", title: "Redwood Creek Challenge Trail", land: "gp", dur: 30, priority: 1, icon: "🌲", link: catt("redwood-creek-challenge-trail"),
      note: "Any height. An outdoor play area with rock walls and a ropes course. Check the app, because it is sometimes closed for refurbishment." },

    // Paradise Gardens Park
    { id: "mermaid", kind: "ride", title: "The Little Mermaid: Ariel's Undersea Adventure", land: "pg", dur: 20, priority: 3, icon: "🧜", ll: true, link: catt("little-mermaid-ariels-undersea-adventure"),
      note: "Any height. A ride under the sea through the movie's songs." },
    { id: "sillyswings", kind: "ride", title: "Silly Symphony Swings", land: "pg", dur: 20, priority: 2, icon: "🎻", minInches: 40, link: catt("silly-symphony-swings"),
      note: "40 inches. Between 40 and 48 inches rides in a two-seat swing with a grown-up. 48 inches can ride alone." },
    { id: "zephyr", kind: "ride", title: "Golden Zephyr", land: "pg", dur: 20, priority: 2, icon: "🛸", link: catt("golden-zephyr"),
      note: "Any height. Silver rockets swing round and round." },
    { id: "jellyfish", kind: "ride", title: "Jumpin' Jellyfish", land: "pg", dur: 20, priority: 2, icon: "🪼", minInches: 40, link: catt("jumpin-jellyfish"),
      note: "40 inches. Jellyfish seats rise up and glide gently back down." },
    { id: "goofysky", kind: "ride", title: "Goofy's Sky School", land: "pg", dur: 25, priority: 2, icon: "✈️", ll: true, minInches: 42, thrill: true, link: catt("goofys-sky-school"),
      note: "42 inches. A small roller coaster. Riders who are too short can use Rider Switch." },

    // Pixar Pier
    { id: "tsmm", kind: "ride", title: "Toy Story Midway Mania!", land: "pp", dur: 30, priority: 4, icon: "🎯", ll: true, link: catt("toy-story-mania"),
      note: "Any height. A 4D game where you ride and aim at moving targets." },
    { id: "incredi", kind: "ride", title: "Incredicoaster", land: "pp", dur: 30, priority: 2, icon: "🎢", ll: true, minInches: 48, thrill: true, link: catt("incredicoaster"),
      note: "48 inches. A high-speed roller coaster. Riders who are too short can use Rider Switch." },
    { id: "jessie", kind: "ride", title: "Jessie's Critter Carousel", land: "pp", dur: 15, priority: 3, icon: "🐴", link: catt("jessies-critter-carousel"),
      note: "Any height. A carousel with Jessie's animal pals from Toy Story. Quick." },
    { id: "whirlwind", kind: "ride", title: "Inside Out Emotional Whirlwind", land: "pp", dur: 20, priority: 2, icon: "🌀", link: catt("emotional-whirlwind"),
      note: "Any height. A spinning ride based on Inside Out." },
    { id: "palaround", kind: "ride", title: "Pixar Pal-A-Round (fixed gondola)", land: "pp", dur: 25, priority: 2, icon: "🎡", link: catt("pixar-pal-a-round-non-swinging"),
      note: "Any height. A Ferris wheel with views over the pier. The fixed gondolas are the gentle ones." },
    { id: "palswing", kind: "ride", title: "Pixar Pal-A-Round (swinging gondola)", land: "pp", dur: 25, priority: 1, icon: "🎡", scary: true, link: catt("pixar-pal-a-round-swinging"),
      note: "Any height. These gondolas swing and slide on the wheel. Pick a fixed gondola for a calmer ride." },
    { id: "pixargames", kind: "break", title: "Games of Pixar Pier", land: "pp", dur: 15, priority: 1, icon: "🎪", link: catt("games-pixar-pier"),
      note: "Midway game booths along the pier." },
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
    // California Adventure: ThemeParks.wiki ride locations, and OpenStreetMap where several share one building.
    dcapals: [33.80733, -117.91917], annaelsa: [33.80729, -117.91733], monsters: [33.80812, -117.91732], philharmagic: [33.80773, -117.91804],
    turtletalk: [33.80756, -117.9175], animacademy: [33.80743, -117.9173], sorcerer: [33.80723, -117.91761],
    webslingers: [33.80665, -117.91826], guardians: [33.80687, -117.91719], rsr: [33.80517, -117.91862], luigis: [33.80553, -117.91854], mater: [33.80624, -117.91925],
    bakery: [33.80606, -117.91976], soarin: [33.80825, -117.92], grizzly: [33.80749, -117.92088], redwood: [33.80697, -117.92138],
    mermaid: [33.80626, -117.92108], sillyswings: [33.80562, -117.9229], zephyr: [33.80603, -117.92227], jellyfish: [33.80614, -117.92253], goofysky: [33.80632, -117.92281],
    tsmm: [33.80465, -117.92184], incredi: [33.80462, -117.9208], jessie: [33.80464, -117.92115], whirlwind: [33.80515, -117.92274],
    palaround: [33.80503, -117.92238], palswing: [33.80496, -117.92228], pixargames: [33.80489, -117.92244],
  };
  const LAND_GEO = { cc: [33.8121, -117.9226], ge: [33.8148, -117.9225], ms: [33.8107, -117.9190], hub: [33.8121, -117.9190], fl: [33.8139, -117.9186], ff: [33.8127, -117.9199], tt: [33.8156, -117.9189], tl: [33.8124, -117.9170], al: [33.8112, -117.9204], nos: [33.8109, -117.9214], fr: [33.8129, -117.9207],
    bvs: [33.8079, -117.919], hw: [33.8077, -117.9172], ac: [33.8066, -117.918], cl: [33.8054, -117.9188], sfs: [33.8059, -117.92], gp: [33.8077, -117.9205], pg: [33.806, -117.9222], pp: [33.8049, -117.9218] };

  /*
    The two parks. gate: the land where you scan in. entry: the first land past the gate (for the early to-dos).
    tour: the order the planner sweeps the lands in. live: the park's id on ThemeParks.wiki (waits.js).
    geo: pins for the stops the planner adds itself (gate, meals, last look, celebration, Lightning Lane to-dos), per park.
  */
  const PARKS = {
    disneyland: { name: "Disneyland Park", short: "Disneyland", gate: "gate", entry: "ms", live: "7340550b-c14d-4def-80bb-acdb51d49a66",
      tour: ["ms", "hub", "ff", "fl", "tt", "tl", "al", "nos", "cc", "ge", "fr"],
      geo: { gate: [33.8094, -117.9191], exit: [33.8092, -117.9189], hop: [33.8094, -117.9191], ll1: [33.8103, -117.9187], ll2: [33.8153, -117.9186], ll3: [33.8123, -117.9174],
        occasion: [33.81023, -117.91947], lunch: [33.81554, -117.91874], dinner: [33.81159, -117.91833], lastlook: [33.8106, -117.919], treat: [33.81166, -117.91937] } },
    dca: { name: "Disney California Adventure Park", short: "California Adventure", gate: "cgate", entry: "bvs", live: "832fcd51-ea19-4e77-85c7-75d5843b127c",
      tour: ["bvs", "hw", "ac", "cl", "sfs", "pp", "pg", "gp"],
      geo: { gate: [33.8087, -117.919], exit: [33.80865, -117.91905], hop: [33.8087, -117.919], ll1: [33.8081, -117.9189], ll2: [33.8077, -117.9205], ll3: [33.806, -117.9222],
        occasion: [33.80835, -117.9192], lunch: [33.80557, -117.9192], dinner: [33.80806, -117.91969], lastlook: [33.8079, -117.91875], treat: [33.8081, -117.9186] } },
  };
  const parkOf = land => (LANDS[land] && LANDS[land].park) || "disneyland";

  // Typical height in inches by age, used only when a child's height is not entered.
  const HEIGHT_BY_AGE = [24, 30, 34, 37, 40, 43, 46, 48, 51, 53, 55, 58, 60, 62, 64, 65, 66, 67];

  /* The date and minutes since midnight at the resort (Anaheim, both parks), whatever timezone the phone is set to. */
  const PARK_TZ = "America/Los_Angeles";
  function parkNow(at) {
    const d = at || new Date();
    try {
      const p = {}; new Intl.DateTimeFormat("en-US", { timeZone: PARK_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(d).forEach(x => { p[x.type] = x.value; });
      return { date: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour % 24) * 60 + +p.minute };
    } catch (e) { // very old browsers without timezone support: fall back to the phone's own clock
      const z = n => String(n).padStart(2, "0");
      return { date: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes() };
    }
  }

  return { T, parkNow, LANDS, WALK, DL, att, ent, dine, catt, cent, cdine, CATALOG, GEO, LAND_GEO, HEIGHT_BY_AGE, PARKS, parkOf };
})();
