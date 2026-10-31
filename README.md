# Disney Day Planner

A phone-sized web app that plans one day at Disneyland Park around your family.

It's built for Disneyland Park in Anaheim, California. It doesn't cover Disney California Adventure, Walt Disney World, Disneyland Paris or the other Disney parks.

You answer five short questions. It builds a minute-by-minute plan with walking times, nap breaks, meals, height limits, a rider switch for kids who are too short, and a map of the route. During the day it re-plans when you run late, skip a ride, or swap one for another.

Fan-made, not affiliated with Disney. Disney, Disneyland and the ride and character names are trademarks of their owners and are used here only to describe the park.

![Setup](docs/screenshots/02-setup-who-is-coming.png)
![Your day](docs/screenshots/05-day.png)
![The route](docs/screenshots/06-map.png)

The people in the screenshots are a made-up family.

## What you get

- A setup flow on first open: park and date, who is coming (names, kids' ages and heights), nap or break time, must-do rides, and any special occasion.
- A plan built from those answers. A birthday adds a City Hall button stop and a treat stop.
- Five tabs: **Now** (what to do next), **Day** (the whole plan), **Map** (the route and walking time), **Family** (who can ride what), and **Settings**.
- Everything stays on your phone. There is no account and no server.
- Optional: share the plan and live locations with the rest of your group (see below). This is off until you set it up.

## Try it on your computer

You need Python, which comes with a Mac.

```
python3 -m http.server 8000
```

Open http://localhost:8000 in your browser. On a computer, make the window narrow to see the phone layout.

## Let Claude Code set it up for you

Open this folder in Claude Code and say:

> set up my day

`CLAUDE.md` tells Claude how this project works. It will ask for your park date, who is coming, nap times and must-do rides, write them into the setup, check the plan for problems like a ride that nobody in your group is tall enough for, and offer to put it online.

You can also ask it to change things later, for example "move lunch to 12:30" or "add the Jungle Cruise as a must-do".

## Put it online (about five minutes)

Hosting is free on Vercel. Your phone needs a web address to open it.

1. Make a free account at vercel.com.
2. Install the Vercel command line tool: `npm install -g vercel`.
3. In this folder, run `vercel`. Accept the defaults. When it asks about a build command or output folder, leave them blank. This project has no build step.
4. Run `vercel --prod`. It prints your address. Open it on your phone.
5. On an iPhone, tap Share, then Add to Home Screen. On Android, use the browser menu, then Add to Home screen.

Each phone keeps its own copy of the plan unless you turn on sharing.

## Share with the group (optional)

This lets everyone in your group see the same plan, mark rides done, and see each other on the map. It uses your own free Supabase project, so nobody else can see your data and nothing goes through anyone else's server.

1. Make a free project at supabase.com.
2. In the project, open **SQL Editor**, paste the contents of `schema.sql`, and run it.
3. Open **Project Settings, then API**. Copy the project URL and the **publishable** key. The publishable key is meant to be public. Never use a secret or service key.
4. In the app, open **Settings** and paste both into the sharing box, then tap **Turn on sharing**.
5. Tap **Copy invite link** and text it to your group. Opening the link loads your plan on their phone. They pick which person they are, and can then share their location.

You can also put the URL and key in `config.js` so every copy of the app starts with sharing ready.

Be aware of how this is protected. Each group gets a long random code, and the database only returns rows for a code you hand over. Anyone who has your invite link can read and edit your plan and see your group's locations. Do not post the link publicly. Delete the project when the trip is over.

## Maps and rights

- The **Park** map is Disney's own illustrated map. The app loads it from Disney's servers while you browse. Nothing from Disney is stored in this project. It is unofficial, so Disney could change or block it at any time. If the tiles stop loading, the app switches to the free street map by itself.
- The **Street** map is OpenStreetMap, which is free and open. The walking routes also come from OpenStreetMap data. © OpenStreetMap contributors, ODbL.
- If you want no Disney requests at all, set `disneyMapTiles: false` in `config.js`.
- There are no Disney photos or logos in this project. The pictures in the app are emoji and drawn shapes.

Ride height limits and details in `catalog.js` are from general knowledge and change. Check the official Disneyland app before you go.

## Where things live

| File | What it does |
|---|---|
| `index.html`, `styles.css` | The page and its look |
| `setup.js` | The five setup questions |
| `catalog.js` | The park's rides, shows, food stops and walking times |
| `planner.js` | Turns your answers plus the catalog into a plan |
| `app.js` | The schedule engine, the tabs, the map and group sharing |
| `intro.js` | The opening animation |
| `main.js` | Decides whether to show setup or the plan |
| `config.js` | Optional settings |
| `paths.js` | Walkway data from OpenStreetMap |
| `schema.sql` | The two tables for group sharing |

## Start over

In the app, open **Settings** and tap **Redo setup**. Or add `?setup` to the address.

## License

MIT, see `LICENSE`. Walkway data in `paths.js` is © OpenStreetMap contributors, ODbL.
