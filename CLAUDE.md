# Disney Day Planner

A static, no-build web app (vanilla JS, Leaflet from a CDN) that plans one day at Disneyland Park. Fan-made, not affiliated with Disney. Serve with `python3 -m http.server 8000`.

## When the user says "set up my day"

1. Ask, in plain English, one short group at a time:
   - Park (only Disneyland Park is built in) and visit date.
   - Who is coming: first names, which are children, children's ages, and heights if known.
   - Arrival time and when they want to be out of the park.
   - Nap or quiet break (yes or no, earliest start, length), and lunch and dinner times.
   - Must-do rides (names from `catalog.js`), and any special occasion (birthday, anniversary, first visit, other).
   - Whether they bought Lightning Lane Multi Pass.
2. Build a profile object (shape: `DDK.defaultProfile()` in `planner.js`) and check it:
   - Open the app with `python3 -m http.server`, or run `DDK.build(profile)` in the browser console, and look for a thrown error.
   - Flag any must-do that nobody in the group is tall enough for, and any ride with a height limit where only children are too short (the plan uses a rider switch).
3. Tell them the quickest way to load it: open the app and answer the questions on screen. The profile is saved in the browser under `dd-profile`. To pre-load one for them, run `localStorage.setItem("dd-profile", JSON.stringify(profile))` in the console and reload.
4. Offer to put it online (README, "Put it online") and to turn on group sharing.

Keep every message plain. The user is probably not a developer.

## How the code fits together

- `catalog.js` holds park data: `LANDS`, walking minutes (`WALK`), and `CATALOG` (each ride, show, meet, meal, break with land, duration, priority, `minInches`, `ll` for Lightning Lane, `window` for open hours).
- `planner.js`: `DDK.build(profile)` returns the day (`PLAN`, `BONUS`, `PEOPLE`, `START`, `GEO`...). Fixed stops (gate, meals, nap, exit) are added here. Must-dos get priority 5.
- `app.js` is the schedule engine (`compute`, `place`, `run`) plus the UI. It reads `window.DD`, which `main.js` sets from the saved profile before loading `app.js`.
- `setup.js` is the onboarding. `main.js` decides setup versus plan, and handles `#join=` invite links.
- State lives in local storage: `dd-profile` (setup answers), `dd-state` (done and skipped marks, order), `dd-local` (current tab, map style), `dd-sync` (optional sharing settings), `dd-intro` (animation throttle).

## Changing things

- Add a ride or stop: add an object to `CATALOG` in `catalog.js` with a unique `id`, `land` key from `LANDS`, and a `link` if useful. Walking times come from the land, so no extra data is needed. Confirm the ride's height limit from the official Disneyland site, not memory.
- A new park is a new `catalog.js` plus map coordinates in `GEO` and `LAND_GEO` and a walkway file like `paths.js`. Say plainly that this is a larger job.
- Change the setup questions in `setup.js`, and add any new field to `defaultProfile()` in `planner.js` so old saved profiles still load.

## Rules for this project

- Never commit photos of real people, Disney map images, Disney logos or artwork. Disney map tiles are loaded at runtime only. Icons are emoji and drawn shapes.
- Never put a secret in the repo. Group sharing uses a Supabase URL and a publishable key only. If a user pastes a secret or service key, tell them to use the publishable key instead and not to commit the secret.
- No build step, no framework. Keep it working by opening `index.html` from a plain web server.
- Test at 375px wide with empty storage (a private window). Check the setup flow end to end, then the Now, Day and Map tabs, and look at the browser console for errors.
- Write user-facing text in plain, full sentences. No em dashes.
