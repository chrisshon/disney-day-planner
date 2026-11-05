"""Smoke test for the Disney Day Planner.

Run:  /Users/chrisshon/dev/AIOS-AAA/.venv/bin/python tests/smoke.py

Serves this folder on a free port with the same headers vercel.json sends (so the content security
policy is exercised too), drives the app in a phone-sized browser, and prints one line per check.
Exits 1 if any check fails. The real database is never contacted: every Supabase request is
intercepted and answered locally.
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
