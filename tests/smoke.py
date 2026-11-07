"""Smoke test for the Disney Day Planner.

Run:  python3 tests/smoke.py   (needs: pip install playwright && playwright install chromium)

Serves this folder on a free port with the same headers vercel.json sends (so the content security
policy is exercised too), drives the app in a phone-sized browser, and prints one line per check.
Exits 1 if any check fails. The real database and the live wait feed are never contacted: every Supabase and ThemeParks.wiki
request is intercepted and answered locally.
"""
import json
import re
import socket
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
START = time.time()
RESULTS = []

HEADERS = {}
for rule in json.loads((ROOT / "vercel.json").read_text()).get("headers", []):
    for h in rule["headers"]:
        HEADERS[h["key"]] = h["value"]


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        for k, v in HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, *a):
        pass


def serve():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    srv = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{port}/"


def check(name, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))


PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001a5f645400000000049454e44ae426082")
DB_CALLS = []  # every request that tried to reach Supabase, so the test can prove none left the machine
WAIT_IDS = dict(re.findall(r'^\s+(\w+): "([0-9a-f-]{36})"', (ROOT / "waits.js").read_text(), re.M))  # stop id -> live feed id, read from the app
FEED_RE = re.compile(r"https://api\.themeparks\.wiki/.*")


def wire(ctx, feedback_status=201, block_leaflet=False):
    """Answer everything outside the local server without touching the real internet where it matters."""
    state = {"feedback": [], "cdn_offline": False}

    def supabase(route):
        req = route.request
        DB_CALLS.append(req.url)
        if req.url.endswith("/rest/v1/planner_feedback") and req.method == "POST":
            state["feedback"].append(json.loads(req.post_data or "{}"))
            route.fulfill(status=state.get("status", feedback_status), body="")
        else:
            route.fulfill(status=200, content_type="application/json", body="[]")

    def cdn(route):
        if block_leaflet:
            return route.abort()
        try:
            route.fulfill(response=route.fetch(timeout=15000))
        except Exception:
            state["cdn_offline"] = True
            route.abort()

    ctx.route(re.compile(r"https://[a-z0-9-]+\.supabase\.co/.*"), supabase)
    ctx.route(re.compile(r"https://cdnjs\.cloudflare\.com/.*"), cdn)
    ctx.route(FEED_RE, lambda r: r.fulfill(status=200, content_type="application/json", body='{"liveData":[]}'))  # default: an empty feed; live-wait checks answer it themselves
    ctx.route(re.compile(r"https://fonts\.googleapis\.com/.*"), lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    ctx.route(re.compile(r"https://fonts\.gstatic\.com/.*"), lambda r: r.fulfill(status=200, body=""))
    ctx.route(re.compile(r"https://(tile\.openstreetmap\.org|cdn6\.parksmedia\.wdprapps\.disney\.com)/.*"), lambda r: r.fulfill(status=200, content_type="image/png", body=PNG))
    return state


def until(page, fn, timeout=15.0):
    """Poll a page function. (page.wait_for_function evaluates a string, which the page's security policy blocks.)"""
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate(fn):
            return True
        page.wait_for_timeout(100)
    raise TimeoutError(fn)


def watch(page):
    errs = []
    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    page.on("console", lambda m: errs.append(f"console: {m.text[:160]}") if m.type == "error" else None)
    return errs


PROFILE = {
    "v": 1, "park": "disneyland", "date": "2026-11-20", "arrive": 510, "leave": 1140, "groupName": "Rivera",
    "people": [
        {"id": "p1", "name": "Ana", "kid": False, "age": None, "inches": None},
        {"id": "p2", "name": "Cleo", "kid": True, "age": 4, "inches": None},
    ],
    "multiPass": True, "nap": {"on": True, "start": 750, "length": 60}, "lunch": 690, "dinner": 1050,
    "mustDo": ["matterhorn"], "occasion": {"type": "none", "forId": "all", "label": ""},
}


def seeded(browser, base, **kw):
    """A phone with a finished setup already saved, optionally in another timezone."""
    ctx = browser.new_context(viewport={"width": 375, "height": 812}, **{k: v for k, v in kw.items() if k == "timezone_id"})
    st = wire(ctx, block_leaflet=kw.get("block_leaflet", False))
    page = ctx.new_page()
    page.add_init_script(
        "if(!localStorage.getItem('dd-profile')){localStorage.setItem('dd-profile',%s);localStorage.setItem('dd-intro',String(Date.now()));}" % json.dumps(json.dumps(PROFILE))
    )
    return ctx, page, st


def main():
    srv, base = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # 1. Setup from empty storage, end to end, then every tab, then feedback.
        ctx = browser.new_context(viewport={"width": 375, "height": 812})
        st = wire(ctx)
        page = ctx.new_page()
        errs = watch(page)
        page.goto(base)
        page.wait_for_selector("[data-nav]", timeout=15000)
        check("Setup starts with empty storage", page.locator("[data-nav=next]").count() == 1)
        for _ in range(12):
            if page.locator("[data-k=date]").count():
                page.fill("[data-k=date]", "2027-03-15")
            if page.locator("[data-k='people.0.name']").count():
                page.fill("[data-k='people.0.name']", "Ana")
            nxt = page.locator("[data-nav=next]")
            fin = page.locator("[data-nav=finish]")
            if fin.count():
                fin.click()
                break
            nxt.click()
            page.wait_for_timeout(120)
        page.wait_for_selector(".tabs button", timeout=15000)
        until(page, "() => !!window.A")
        for skip in ("#introSkip", ".intro .skip", "[data-intro-skip]"):
            if page.locator(skip).count() and page.locator(skip).first.is_visible():
                page.locator(skip).first.click()
        page.evaluate("() => { try { document.querySelector('#intro, .intro')?.remove(); } catch (e) {} }")
        check("Setup finishes and the plan appears", page.locator(".tabs button").count() >= 4 and page.evaluate("!!localStorage.getItem('dd-profile')"))
        for tab in ("now", "day", "map", "settings"):
            page.evaluate("t => A.tab(t)", tab)
            page.wait_for_timeout(350)
            has = page.locator("#view").inner_text().strip() != "" or tab == "map"
            check(f"{tab.capitalize()} tab shows content", has)
        check("Map tab shows a map or a plain notice", page.locator("#map, .leaflet-container, .notice").count() > 0)

        # Feedback sheet: failure first, then success, then the limit.
        page.evaluate("A.tab('settings')")
        page.wait_for_timeout(200)
        page.get_by_role("button", name="Send feedback").click()
        page.wait_for_selector("#fbMsg")
        check("Feedback sheet opens with the privacy line", "Please don't include anything private" in page.locator("#fbBody").inner_text())
        page.click("#fbSend")
        check("Empty note is refused with a message", "write a note" in page.locator("#fbErr").inner_text().lower())
        page.fill("#fbMsg", "The Matterhorn card is great.")
        st["status"] = 500
        page.click("#fbSend")
        until(page, "() => document.querySelector('#fbErr').textContent.length > 0")
        check("Failed send keeps the text and says so", page.input_value("#fbMsg") == "The Matterhorn card is great." and "didn't send" in page.locator("#fbErr").inner_text() and page.locator("#fbSend").is_enabled())
        st["status"] = 201
        page.fill("#fbEmail", "mom@example.com")
        page.click("#fbSend")
        page.wait_for_selector(".fbthanks")
        check("Successful send shows the thanks line", "Thanks. Your note was sent." in page.locator(".fbthanks").inner_text())
        body = st["feedback"][-1] if st["feedback"] else {}
        check("Sent note has only the expected fields", set(body) == {"message", "email", "screen", "app_version", "user_agent"} and body.get("screen") == "settings" and body.get("email") == "mom@example.com", str(sorted(body)))
        check("Sent note carries no names or plan data", "Ana" not in json.dumps(body) and "Cleo" not in json.dumps(body))
        for i in range(3):  # 2 more successes reach the limit of 3, then a fourth is refused
            page.locator("#fbBody .actions .btn").first.click() if page.locator(".fbthanks").count() else page.locator("#modal .x").click()
            page.get_by_role("button", name="Send feedback").click()
            page.wait_for_selector("#fbMsg")
            page.fill("#fbMsg", f"note {i}")
            page.click("#fbSend")
            until(page, "() => !!document.querySelector('.fbthanks') || document.querySelector('#fbErr').textContent.length > 0")
            if page.locator("#fbErr").count() and page.locator("#fbErr").inner_text():
                break
        check("More than 3 notes in 10 minutes is refused", "few notes" in page.locator("#fbErr").inner_text() and len(st["feedback"]) == 4, f"requests={len(st['feedback'])}")  # 1 failed on purpose + 3 delivered
        check("No console or page errors through setup, tabs and feedback", not [e for e in errs if not ("status of 500" in e or (st["cdn_offline"] and "cdnjs" in e))], "; ".join(errs[:3]))  # the one 500 is the deliberate failed send
        ctx.close()

        # 2. Regression checks on a seeded phone.
        ctx, page, st2 = seeded(browser, base)
        errs2 = watch(page)
        page.goto(base)
        page.wait_for_selector(".tabs button", timeout=15000)
        until(page, "() => !!window.A")
        src = (ROOT / "app.js").read_text()
        fnsrc = re.search(r"function parseWin\(s\) \{[\s\S]*?\n  \}\n", src).group(0)
        nctx = browser.new_context(bypass_csp=True)  # only this tiny check needs eval; every other check runs under the real policy
        npage = nctx.new_page()
        pw = npage.evaluate("(code) => { const f = new Function(code + '; return parseWin;')(); return [f('12:40-1:40'), f('11:30-12:30'), f('2:15-3:15')]; }", fnsrc)
        nctx.close()
        check("Return window 12:40-1:40 reads as 12:40 to 1:40 pm", pw[0] == [760, 820], str(pw[0]))
        check("Return window 11:30-12:30 reads as 11:30 am to 12:30 pm", pw[1] == [690, 750], str(pw[1]))
        page.evaluate("A.pref('departure', '840')")
        dep = page.evaluate("JSON.parse(localStorage.getItem('dd-state')).prefs.departure")
        check("Leave-the-park setting is saved as a number", dep == 840 and isinstance(dep, (int, float)), repr(dep))
        bad = page.evaluate(
            """() => { try { const p = DDK.defaultProfile(); p.people = [{id: "a');window.__pwn=1;//", name: 'X'}]; DDK.build(p); return 'accepted'; } catch (e) { return 'rejected'; } }"""
        )
        check("A person id that is not p1, p2, p3 is rejected", bad == "rejected", bad)
        page.evaluate("A.tab('map')")
        page.wait_for_timeout(500)
        if st2["cdn_offline"]:
            print("SKIP  Map loads under the security policy and integrity hash  (no network to the CDN)")
        else:
            check("Map library loads under the security policy and integrity hash", page.evaluate("() => !!window.L") and page.locator(".leaflet-container").count() == 1)
        check("No errors on the seeded phone", not [e for e in errs2 if not (st2["cdn_offline"] and "cdnjs" in e)], "; ".join(errs2[:3]))
        ctx.close()

        # 2b. An invite link that points at an outside host must be refused without contacting it.
        import base64
        hit = []
        ctx = browser.new_context(viewport={"width": 375, "height": 812})
        wire(ctx)
        ctx.route(re.compile(r"https://evil\.test/.*"), lambda r: (hit.append(r.request.url), r.fulfill(status=200, body="[]")))
        page = ctx.new_page()
        link = base64.b64encode(json.dumps({"s": "abcdefgh12345", "u": "https://evil.test", "k": "k" * 30}).encode()).decode()
        page.goto(base + "#join=" + link)
        page.wait_for_timeout(1200)
        txt = page.locator("body").inner_text()
        check("Invite link to an outside host is refused and never contacted", not hit and "unexpected" in txt, f"hit={hit}")
        link = base64.b64encode(json.dumps({"s": "abcdefgh12345", "u": 42, "k": "k" * 30}).encode()).decode()
        page.goto(base + "#join=" + link)
        page.wait_for_timeout(800)
        check("Invite link with a number where text belongs shows a message, not a blank page", len(page.locator("body").inner_text().strip()) > 20)
        ctx.close()

        # 3. Time zone: a New York phone at 9:00 am Pacific must show 9:00.
        ctx = browser.new_context(viewport={"width": 375, "height": 812}, timezone_id="America/New_York")
        wire(ctx)
        page = ctx.new_page()
        page.add_init_script("localStorage.setItem('dd-profile',%s);localStorage.setItem('dd-intro',String(Date.now()));" % json.dumps(json.dumps(PROFILE)))
        page.clock.install(time="2026-11-20T17:00:00Z")
        page.goto(base)
        page.wait_for_selector("#clock", timeout=15000)
        clock = page.locator("#clock").inner_text()
        check("Clock uses park time (Los Angeles), not the phone's timezone", "9:0" in clock and "12:0" not in clock, clock)
        ctx.close()

        # 4. The map library blocked: the Day tab must still work.
        ctx = browser.new_context(viewport={"width": 375, "height": 812})
        wire(ctx, block_leaflet=True)
        page = ctx.new_page()
        errs4 = []
        page.on("pageerror", lambda e: errs4.append(str(e)))
        page.add_init_script("localStorage.setItem('dd-profile',%s);localStorage.setItem('dd-intro',String(Date.now()));" % json.dumps(json.dumps(PROFILE)))
        page.goto(base)
        page.wait_for_selector(".tabs button", timeout=15000)
        until(page, "() => !!window.A")
        page.evaluate("A.tab('day')")
        page.wait_for_timeout(300)
        check("Day tab renders with the map library blocked", len(page.locator("#view").inner_text().strip()) > 20 and not errs4, "; ".join(errs4[:2]))
        page.evaluate("A.tab('map')")
        page.wait_for_timeout(300)
        check("Map tab explains itself when the library is blocked", "could not load" in page.locator("#view").inner_text())
        ctx.close()


        # 5. Live wait times. The feed is always answered by the test; the real one is never contacted.
        FRESH, STALE = "2026-11-20T16:59:30Z", "2026-11-20T16:30:00Z"  # the fake page clock reads 9:00 am Pacific = 17:00Z

        def feed_body(entries, updated=FRESH):
            live = []
            for cid, e in entries.items():
                q = {}
                if e.get("wait") is not None:
                    q["STANDBY"] = {"waitTime": e["wait"]}
                if e.get("ret"):
                    q["RETURN_TIME"] = {"state": "AVAILABLE", "returnStart": e["ret"][0], "returnEnd": e["ret"][1]}
                live.append({"id": WAIT_IDS[cid], "name": cid, "entityType": "ATTRACTION", "status": e.get("status", "OPERATING"), "lastUpdated": updated, "queue": q})
            return json.dumps({"id": "park", "liveData": live})

        def live_page(entries=None, updated=FRESH, mode="ok", on_visit_day=True):
            """A phone on the visit day (9:00 am Pacific) whose wait feed is answered by this test."""
            ctx = browser.new_context(viewport={"width": 375, "height": 812})
            wire(ctx)
            feed = {"calls": 0}

            def handler(route):
                feed["calls"] += 1
                if mode == "abort":
                    return route.abort()
                if mode == "503":
                    return route.fulfill(status=503, body="unavailable")
                if mode == "garbage":
                    return route.fulfill(status=200, content_type="application/json", body="<html>not json")
                route.fulfill(status=200, content_type="application/json", body=feed_body(entries or {}, updated))

            ctx.route(FEED_RE, handler)
            page = ctx.new_page()
            errs = watch(page)
            page.add_init_script("localStorage.setItem('dd-profile',%s);localStorage.setItem('dd-intro',String(Date.now()));" % json.dumps(json.dumps(PROFILE)))
            if on_visit_day:
                page.clock.install(time="2026-11-20T17:00:00Z")
            page.goto(base)
            page.wait_for_selector(".tabs button", timeout=15000)
            until(page, "() => !!window.A")
            return ctx, page, errs, feed

        ROWS = """() => [...document.querySelectorAll('#view .list .rowwrap')].map(r => ({
            title: r.querySelector('h3').textContent, t: r.querySelector('.t').childNodes[0].textContent.trim(),
            chips: [...r.querySelectorAll('.tag.wait')].map(x => x.textContent), note: (r.querySelector('.waitnote') || {}).textContent || ''}))"""
        KINDS = "() => Object.fromEntries(DD.PLAN.concat(DD.BONUS).map(i => [i.title, {id: i.id, kind: i.kind, ll: i.ll === true}]))"

        def minutes(t):
            m = re.match(r"(\d+):(\d+) (am|pm)", t)
            h = int(m.group(1)) % 12 + (12 if m.group(3) == "pm" else 0)
            return h * 60 + int(m.group(2))

        def day_rows(page):
            page.evaluate("A.tab('day')")
            page.wait_for_timeout(250)
            return page.evaluate(ROWS)

        # 5a. Baseline plan with an empty feed, and pick the stops to test from it.
        ctx, page, errs, feed = live_page({})
        until(page, "() => true")
        page.wait_for_timeout(500)
        base_rows = day_rows(page)
        kinds = page.evaluate(KINDS)
        rides = [i for i, r in enumerate(base_rows) if kinds.get(r["title"], {}).get("kind") == "ride" and not kinds[r["title"]]["ll"]]
        ll_rides = [i for i, r in enumerate(base_rows) if kinds.get(r["title"], {}).get("ll")]
        check("Empty live feed shows no wait chips and no credit link", not any(r["chips"] for r in base_rows) and page.locator("#view a[href='https://themeparks.wiki']").count() == 0)
        ctx.close()
        i_r, i_d = rides[0], rides[1]
        R, N, DN = base_rows[i_r], base_rows[i_r + 1], base_rows[i_d]
        rid, did = kinds[R["title"]]["id"], kinds[DN["title"]]["id"]
        lid = kinds[base_rows[ll_rides[0]]["title"]]["id"] if ll_rides else None
        print(f"      (live test uses ride={rid}, next stop={N['title']}, down={did}, lightning={lid})")

        entries = {rid: {"wait": 45}, did: {"status": "DOWN"}}
        if lid:
            entries[lid] = {"wait": 20, "ret": ("2026-11-20T14:40:00-08:00", "2026-11-20T15:40:00-08:00")}
        ctx, page, errs, feed = live_page(entries)
        until(page, "() => !!window.A")
        page.evaluate("A.tab('day')")
        until(page, "() => !!document.querySelector('#view .tag.wait')")
        rows = page.evaluate(ROWS)
        by = {r["title"]: r for r in rows}
        check("A ride shows its live wait as a chip", by[R["title"]]["chips"] == ["45 min wait"], str(by[R["title"]]["chips"]))
        check("A ride that is down shows 'Down right now' and a note about Later or Skip", by[DN["title"]]["chips"] == ["Down right now"] and "Later" in by[DN["title"]]["note"] and "Skip" in by[DN["title"]]["note"], str(by[DN["title"]]))
        if lid:
            check("A Lightning Lane ride shows its next return time", by[base_rows[ll_rides[0]]["title"]]["chips"] == ["Lightning Lane return 2:40 pm"], str(by[base_rows[ll_rides[0]]["title"]]["chips"]))
        n_live = next(r for r in rows if r["title"] == N["title"])
        check("The plan uses the live wait: the next stop starts later than with no live data", minutes(n_live["t"]) > minutes(N["t"]), f"{N['t']} -> {n_live['t']}")
        check("The Day tab credits ThemeParks.wiki with a link", page.locator("#view a[href='https://themeparks.wiki']", has_text="Powered by ThemeParks.wiki").count() == 1)
        page.evaluate("A.tab('settings')")
        page.wait_for_timeout(200)
        check("Settings has the Live wait times switch (on) and the credit link", page.locator("#liveWaits").is_checked() and page.locator("#view a[href='https://themeparks.wiki']").count() == 1)
        if st2["cdn_offline"]:
            print("SKIP  Map pin sheet shows the wait  (no network to the CDN)")
        else:
            page.evaluate("A.tab('map')")
            page.wait_for_timeout(500)
            page.evaluate("id => A.mapSel(id)", rid)
            page.wait_for_timeout(300)
            check("The Map pin sheet shows the wait", "45 min wait" in page.locator("#sheet").inner_text(), page.locator("#sheet").inner_text()[:80])
        page.evaluate("A.tab('now')")
        page.wait_for_timeout(250)
        check("The Now tab shows the wait on the current stop or the ones after it", page.locator("#view .tag.wait").count() >= 1)
        check("The page asked for the feed once, not repeatedly", feed["calls"] == 1, str(feed["calls"]))
        # Switch off: chips, credit and the longer plan all go away. Switch on: they return from what was already fetched.
        page.evaluate("A.tab('settings')")
        page.wait_for_timeout(200)
        page.locator("#liveWaits").uncheck()
        page.wait_for_timeout(250)
        off_rows = day_rows(page)
        off_n = next(r for r in off_rows if r["title"] == N["title"])
        check("Switching live waits off hides every wait, the credit and the live plan", not any(r["chips"] or r["note"] for r in off_rows) and page.locator("#view a[href='https://themeparks.wiki']").count() == 0 and off_n["t"] == N["t"], f"{off_n['t']} vs {N['t']}")
        check("The switch is saved with the other phone settings", page.evaluate("JSON.parse(localStorage.getItem('dd-local')).liveWaits") is False)
        page.evaluate("A.tab('settings')")
        page.wait_for_timeout(200)
        page.locator("#liveWaits").check()
        page.wait_for_timeout(250)
        check("Switching live waits back on shows them again", any(r["chips"] for r in day_rows(page)))
        check("No console or page errors with live waits on", not [e for e in errs if not (st2["cdn_offline"] and "cdnjs" in e)], "; ".join(errs[:3]))
        ctx.close()

        # 5b. Old data counts as missing.
        ctx, page, errs, feed = live_page(entries, updated=STALE)
        page.wait_for_timeout(600)
        check("Data older than 15 minutes is not shown or used", feed["calls"] >= 1 and not any(r["chips"] for r in day_rows(page)) and next(r for r in page.evaluate(ROWS) if r["title"] == N["title"])["t"] == N["t"])
        ctx.close()

        # 5c. The feed failing in each way leaves the app quiet and unchanged.
        for mode in ("garbage", "503", "abort"):
            ctx, page, errs, feed = live_page(entries, mode=mode)
            page.wait_for_timeout(600)
            rows = day_rows(page)
            # The browser itself logs a line for a failed request; that is not an app error, so it is the only thing allowed through.
            real = [e for e in errs if "Failed to load resource" not in e and not (st2["cdn_offline"] and "cdnjs" in e)]
            same = [(r["title"], r["t"]) for r in rows] == [(r["title"], r["t"]) for r in base_rows]
            check(f"Feed failure ({mode}): no wait shown, plan unchanged, no errors", feed["calls"] >= 1 and not any(r["chips"] for r in rows) and same and not real and (mode != "garbage" or not errs), "; ".join(errs[:3]))
            ctx.close()

        # 5d. Not the visit day: the feed is never asked.
        ctx, page, errs, feed = live_page(entries, on_visit_day=False)
        page.wait_for_timeout(800)
        check("No feed request on a day that is not the visit day", feed["calls"] == 0, str(feed["calls"]))
        ctx.close()

        # 6. California Adventure and park hopping.
        def park_page(profile, entries=None, visit_day=False):
            ctx = browser.new_context(viewport={"width": 375, "height": 812})
            wire(ctx)
            feed = {"urls": []}

            def handler(route):
                feed["urls"].append(route.request.url)
                route.fulfill(status=200, content_type="application/json", body=feed_body(entries or {}))

            ctx.route(FEED_RE, handler)
            page = ctx.new_page()
            errs = watch(page)
            page.add_init_script("localStorage.setItem('dd-profile',%s);localStorage.setItem('dd-intro',String(Date.now()));" % json.dumps(json.dumps(profile)))
            if visit_day:
                page.clock.install(time="2026-11-20T17:00:00Z")
            page.goto(base)
            page.wait_for_selector(".tabs button", timeout=15000)
            until(page, "() => !!window.A")
            page.evaluate("() => { try { document.querySelector('#intro, .intro')?.remove(); } catch (e) {} }")
            return ctx, page, errs, feed

        # Each Day tab row with its stop id, park and start time. Phone to-dos are left out: they happen wherever you stand.
        PARK_ROWS = """() => { const byTitle = {}; DD.PLAN.concat(DD.BONUS).forEach(i => { byTitle[i.title] = i; });
            return [...document.querySelectorAll('#view .list .rowwrap')].map(r => { const it = byTitle[r.querySelector('h3').textContent];
              return { id: it.id, kind: it.kind, park: DD.parkOf(it.land), t: r.querySelector('.t').childNodes[0].textContent.trim(), walk: (r.querySelector('.t small') || {}).textContent || '' }; }); }"""
        OLD_PLAN = ["gate", "ll1", "matterhorn", "smallworld", "carrousel", "dumbo", "royalhall", "lunch", "nap", "mickeyhouse", "runaway", "gadget", "castlewalk", "buzz", "autopia", "ll3", "ll2", "dinner", "lastlook", "exit"]  # PROFILE's plan before park hopping existed (commit c4ddad1)
        HOP = dict(PROFILE, hop={"to": "dca", "at": 780}, mustDo=["matterhorn", "rsr"])
        DCA = dict(PROFILE, park="dca", mustDo=["tsmm"])

        ctx, page, errs, feed = park_page(PROFILE)
        check("A plan saved before park hopping gives the same day as before", page.evaluate("DD.PLAN.map(x => x.id)") == OLD_PLAN, str(page.evaluate("DD.PLAN.map(x => x.id)")))
        check("Saved answers without the hopping fields read as one park all day", page.evaluate("p => DD.SECOND === null && JSON.stringify(DDK.build(p).PLAN.map(x => x.id)) === JSON.stringify(DDK.build(Object.assign({}, p, {hop: {to: '', at: null}})).PLAN.map(x => x.id))", PROFILE))
        bad = page.evaluate("""() => { const out = [];
            const check = p => { try { DDK.checkProfile(p); return 'ok'; } catch (e) { return 'rejected'; } };
            out.push(check(Object.assign({}, DD.PROFILE, {park: 'epcot'})), check(Object.assign({}, DD.PROFILE, {hop: {to: 'disneyland', at: null}})), check(Object.assign({}, DD.PROFILE, {hop: {to: 'dca', at: 'noon'}})), check(Object.assign({}, DD.PROFILE, {park: 'constructor'})), check(Object.assign({}, DD.PROFILE, {hop: {to: '__proto__', at: null}})));
            return out; }""")
        check("Saved answers naming an unknown park, a hop to the same park or a bad hop time are rejected", bad == ["rejected"] * 5, str(bad))
        dca_items = page.evaluate("DDK.CATALOG.filter(c => DDK.parkOf(c.land) === 'dca').map(c => ({id: c.id, kind: c.kind, link: c.link || '', h: c.minInches || 0}))")
        check("California Adventure has 26 or more rides, shows and meets, each linked to its disneyland.com page",
              len([c for c in dca_items if c["kind"] != "break"]) >= 26 and all(c["link"].startswith("https://disneyland.disney.go.com/") and "disney-california-adventure" in c["link"] for c in dca_items), str(len(dca_items)))
        ctx.close()

        # A day hopping from Disneyland to California Adventure at about 1:00 pm.
        ctx, page, errs, feed = park_page(HOP)
        page.evaluate("A.tab('day')")
        page.wait_for_timeout(300)
        rows = page.evaluate(PARK_ROWS)
        ids = [r["id"] for r in rows]
        hop_i = ids.index("hop") if "hop" in ids else -1
        walking = [r for r in rows if r["kind"] != "task"]
        before = [r["park"] for r in walking[:walking.index(rows[hop_i])]] if hop_i >= 0 else []
        after = [r["park"] for r in walking[walking.index(rows[hop_i]) + 1:]] if hop_i >= 0 else []
        check("A hopping day has one hop", ids.count("hop") == 1, str(ids))
        check("Every stop before the hop is in Disneyland and every stop after it is in California Adventure", before and after and set(before) == {"disneyland"} and set(after) == {"dca"}, f"{before} | {after}")
        check("The hop happens near the chosen time (1:00 pm)", hop_i >= 0 and 12 * 60 + 30 <= minutes(rows[hop_i]["t"]) <= 14 * 60, rows[hop_i]["t"] if hop_i >= 0 else "none")
        check("The hop counts the walk across the Esplanade", hop_i >= 0 and "walk" in rows[hop_i]["walk"] and int(rows[hop_i]["walk"].split()[0]) >= 10, rows[hop_i]["walk"] if hop_i >= 0 else "")
        check("Both must-dos are in the plan, one in each park", {"matterhorn", "rsr"} <= set(ids))
        check("The header names both parks and the map title says Disneyland Resort", "Disneyland and California Adventure" in page.locator("#eyebrow").text_content() and page.locator(".maptitle .eyebrow").text_content() == "Disneyland Resort")
        added = page.evaluate("""() => { const pk = id => DD.parkOf(DD.BONUS.concat(DD.PLAN).find(i => i.id === id).land);
            const a = DD.BONUS.find(b => pk(b.id) === 'dca' && !b.minInches), b = DD.BONUS.find(x => pk(x.id) === 'disneyland' && !x.minInches);
            A.add(a.id); A.add(b.id); const st = JSON.parse(localStorage.getItem('dd-state')), h = st.order.indexOf('hop');
            return { dca: st.order.indexOf(a.id) > h, dl: st.order.indexOf(b.id) < h }; }""")
        check("Adding a stop puts it in its own park's part of the day", added == {"dca": True, "dl": True}, str(added))
        page.evaluate("A.swapModal('rsr')")
        page.wait_for_timeout(300)
        swap_parks = page.evaluate("() => { const byTitle = {}; DD.PLAN.concat(DD.BONUS).forEach(i => { byTitle[i.title] = i; }); return [...new Set([...document.querySelectorAll('#modal .cand .ctitle')].map(e => DD.parkOf(byTitle[e.textContent].land)))]; }")
        check("Swap only offers stops in the same park on a hopping day", swap_parks == ["dca"], str(swap_parks))
        page.evaluate("A.closeModal()")
        moved = page.evaluate("""() => { A.llReturn('monsters', '9:30-10:30'); A.llReturn('smallworld', '4:00-5:00'); A.skip('hop');
            const byTitle = {}; DD.PLAN.concat(DD.BONUS).forEach(i => { byTitle[i.title] = i; }); A.tab('day');
            const ids = [...document.querySelectorAll('#view .list .rowwrap h3')].map(h => byTitle[h.textContent].id), h = ids.indexOf('hop');
            const st = JSON.parse(localStorage.getItem('dd-state'));
            return { smallworld: ids.indexOf('smallworld') > h, hopKept: h >= 0 && st.statuses.hop !== 'skipped' }; }""")
        check("A Disneyland return time after the hop is kept where the window puts it", moved["smallworld"], str(moved))
        cross = page.evaluate("() => { const r = [...document.querySelectorAll('#view .list .rowwrap')].find(x => x.querySelector('h3').textContent.startsWith('Monsters')), s = [...document.querySelectorAll('#view .list .rowwrap')].find(x => x.querySelector('h3').textContent.includes('small world')); return r && s ? { tag: r.textContent.includes('walk across') && s.textContent.includes('In Disneyland, walk across'), t: r.querySelector('.t').childNodes[0].textContent.trim() } : null; }")
        check("Return times in the other park are kept and flagged as a walk across, both ways", cross is not None and cross["tag"] and minutes(cross["t"]) < 11 * 60, str(cross))
        check("The hop cannot be skipped", moved["hopKept"] and page.evaluate("A.openRow('hop'), !document.querySelector('.rowwrap.open .dx').textContent.includes('Skip')"), str(moved))
        ghost = page.evaluate("""() => { const pk = id => DD.parkOf(DD.PLAN.concat(DD.BONUS).find(i => i.id === id).land);
            const order = JSON.parse(localStorage.getItem('dd-state')).order; const g = DD.BONUS.find(b => pk(b.id) === 'dca' && DD.GEO[b.id] && !order.includes(b.id)); A.tab('map'); A.mapSel(g.id); return g.id; }""")
        page.wait_for_timeout(600)
        opts = page.evaluate("id => { const s = document.querySelector('#sheet select.swap'); return s ? [...s.options].slice(1).map(o => DD.parkOf(DD.PLAN.find(i => i.id === o.value).land)) : null; }", ghost)
        check("The map's swap list only offers stops in the same park", opts is not None and set(opts) == {"dca"}, str(opts))
        page.evaluate("A.mapSel(null)")
        page.evaluate("A.tab('map')")
        page.wait_for_timeout(1200)
        pins = page.evaluate("() => ({ rsr: !!DD.GEO.rsr, matterhorn: !!DD.GEO.matterhorn, hop: !!DD.GEO.hop, markers: document.querySelectorAll('.leaflet-marker-icon.pinwrap').length })")
        check("The map has pins in both parks and at the hop", pins["rsr"] and pins["matterhorn"] and pins["hop"] and pins["markers"] > 20, str(pins))
        for tab in ("now", "family", "settings"):
            page.evaluate("t => A.tab(t)", tab)
            page.wait_for_timeout(200)
        check("No console or page errors on a hopping day", not [e for e in errs if not (st2["cdn_offline"] and "cdnjs" in e)], "; ".join(errs[:3]))
        ctx.close()

        # Live waits on a hopping visit day: one feed per park, and California Adventure rides show their waits.
        ctx, page, errs, feed = park_page(HOP, entries={"rsr": {"wait": 75}, "matterhorn": {"wait": 20}}, visit_day=True)
        page.evaluate("A.tab('day')")
        page.wait_for_timeout(600)
        chips = page.evaluate("() => Object.fromEntries([...document.querySelectorAll('#view .list .rowwrap')].map(r => [r.querySelector('h3').textContent, [...r.querySelectorAll('.tag.wait')].map(x => x.textContent)]))")
        urls = feed["urls"]
        check("A hopping visit day asks each park's feed once", len(urls) == 2 and any("7340550b" in u for u in urls) and any("832fcd51" in u for u in urls), str(urls))
        check("A California Adventure ride shows its live wait", chips.get("Radiator Springs Racers") == ["75 min wait"], str(chips.get("Radiator Springs Racers")))
        check("A Disneyland ride still shows its live wait on a hopping day", chips.get("Matterhorn Bobsleds") == ["20 min wait"], str(chips.get("Matterhorn Bobsleds")))
        ctx.close()

        # A California Adventure day: nothing from Disneyland, and no Disneyland-only wording.
        ctx, page, errs, feed = park_page(DCA)
        page.evaluate("A.tab('day')")
        page.wait_for_timeout(300)
        lands = page.evaluate("[...new Set(DD.PLAN.concat(DD.BONUS).map(i => DD.parkOf(i.land)))]")
        txt = ""
        for tab in ("now", "day", "family", "settings"):
            page.evaluate("t => A.tab(t)", tab)
            page.wait_for_timeout(200)
            txt += page.locator("#view").inner_text() + "\n"
        txt += page.evaluate("DD.PLAN.map(i => i.title + ' ' + (i.note || '')).join(' ')")
        wrong = [w for w in ("Disneyland Park", "Main Street", "City Hall", "Toontown", "Matterhorn", "Plaza Inn") if w in txt]
        check("A California Adventure day only has California Adventure stops", lands == ["dca"], str(lands))
        check("A California Adventure day never names Disneyland Park or its lands", not wrong and "Disney California Adventure Park" in page.locator("#eyebrow").text_content(), str(wrong))
        page.evaluate("A.tab('map')")
        page.wait_for_timeout(800)
        check("No console or page errors on a California Adventure day", not [e for e in errs if not (st2["cdn_offline"] and "cdnjs" in e)], "; ".join(errs[:3]))
        ctx.close()

        # Setup: start in California Adventure, hop to Disneyland, let the planner choose when.
        ctx = browser.new_context(viewport={"width": 375, "height": 812})
        wire(ctx)
        page = ctx.new_page()
        errs = watch(page)
        page.goto(base + "?setup")
        page.wait_for_selector("[data-k=park]", timeout=15000)
        page.select_option("[data-k=park]", "dca")
        page.locator("[data-hop]").check()
        page.wait_for_timeout(150)
        check("Setup offers a time to switch parks, defaulting to the planner's choice", page.locator("[data-k='hop.at']").count() == 1 and page.input_value("[data-k='hop.at']") == "")
        page.fill("[data-k=date]", "2027-03-15")
        saw_parks = []
        for _ in range(8):
            if page.locator("[data-k='people.0.name']").count():
                page.fill("[data-k='people.0.name']", "Ana")
            saw_parks += page.locator("#setup .grp.park").all_inner_texts()
            if page.locator("[data-nav=finish]").count():
                page.locator("[data-nav=finish]").click()
                break
            page.locator("[data-nav=next]").click()
            page.wait_for_timeout(120)
        page.wait_for_selector(".tabs button", timeout=15000)
        until(page, "() => !!window.DD")
        check("The must-do list shows both parks on a hopping day", saw_parks == ["Disney California Adventure Park", "Disneyland Park"], str(saw_parks))
        got = page.evaluate("({ first: DD.FIRST, second: DD.SECOND, hop: DD.PLAN.some(i => i.id === 'hop'), at: DD.HOP_AT })")
        check("Setup saves a California Adventure start with a hop to Disneyland", got["first"] == "dca" and got["second"] == "disneyland" and got["hop"] and got["at"] is not None, str(got))
        check("No console or page errors in the hopping setup", not [e for e in errs if not (st2["cdn_offline"] and "cdnjs" in e)], "; ".join(errs[:3]))
        ctx.close()

        browser.close()
    srv.shutdown()

    check("Every database request was answered by the test, none left the machine", len(DB_CALLS) > 0, f"{len(DB_CALLS)} intercepted")
    elapsed = time.time() - START
    check("Finished under 90 seconds", elapsed < 90, f"{elapsed:.1f}s")
    failed = RESULTS.count(False)
    print(f"\n{len(RESULTS) - failed}/{len(RESULTS)} checks passed in {elapsed:.1f}s")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
