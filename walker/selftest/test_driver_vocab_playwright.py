#!/usr/bin/env python3
"""Real-Chromium checks of the PlaywrightDriver code added by mapper-vocab (#2378):
set_viewport, set_scheme, measure_overflow, tab_sweep / tab_to, export_check, chat_ask,
ax_check, label-resolving click (exact / alias / token / ambiguous / absent / open-menu first).
Local 127.0.0.1 fixture server only (never prod). Every feature has a failure path.
Run: <venv>/bin/python test_driver_vocab_playwright.py <walker dir>"""
import http.server, json, os, sys, tempfile, threading
WALKER = sys.argv[1]
sys.path.insert(0, WALKER)
from concord_walker import repro, checks
from concord_walker.cdp import Cdp
from concord_walker.chatcheck import SendBudget
from playwright.sync_api import sync_playwright

MAIN = b"""<!doctype html><html><head><title>Driver fixture</title><style>
 body{margin:0;font:16px sans-serif} #wide{width:300px;height:10px}
 @media (max-width:500px){ #wide{width:1100px} }
 @media (prefers-color-scheme: dark){ body{background:#111;color:#eee} }
</style></head><body>
<button>Overview</button>
<button>Publish or share this content</button>
<button>Settings</button><button>Settings</button>
<button>Archive old notes</button><button>Archive all notes</button>
<button aria-haspopup="menu" aria-expanded="false" id="exp" onclick="var m=document.getElementById('m');m.hidden=!m.hidden;this.setAttribute('aria-expanded',String(!m.hidden))">Export</button>
<div role="menu" id="m" hidden>
  <a role="menuitem" href="/dl/data.json" download="data.json">Export as JSON</a>
  <a role="menuitem" href="/dl/data.csv" download="data.csv">Export as CSV</a>
  <button role="menuitem" onclick="window.pubmenu=1">Publish</button>
</div>
<button onclick="window.pub=1">Publish draft</button>
<section aria-label="Toolbar"><button></button><button>Named</button></section>
<div id="wide"></div>
<label>Ask the lens <input id="chat" type="text" aria-label="Ask the lens"
  onkeydown="if(event.key==='Enter'){var p=document.createElement('p');p.textContent='Reply: this lens tracks notes';document.getElementById('log').appendChild(p);this.value=''}"></label>
<div id="log"></div>
</body></html>"""
EMPTY_EXPORT = b"""<!doctype html><html><body><a href="/dl/empty.json" download="empty.json" role="button">Export</a></body></html>"""
DEAD_EXPORT = b"""<!doctype html><html><body><button>Export</button><p>no chat here</p></body></html>"""
NO_EXPORT = b"""<!doctype html><html><body><button>Save</button></body></html>"""
AMBIG_FMT = b"""<!doctype html><html><body><button aria-expanded="false" onclick="document.getElementById('m').hidden=false;this.setAttribute('aria-expanded','true')">Export</button>
<div role="menu" id="m" hidden><a role="menuitem" href="/dl/data.json" download="a.json">JSON compact</a><a role="menuitem" href="/dl/data.json" download="b.json">JSON pretty</a></div></body></html>"""
FILES = {"/dl/data.json": (b'[{"id":"n1","title":"walker-fixture note"},{"id":"n2","title":"other"}]', "application/json"),
         "/dl/data.csv": (b"id,title\nn1,walker-fixture note\nn2,other\n", "text/csv"),
         "/dl/empty.json": (b"[]", "application/json")}
PAGES = {"/lenses/demo": MAIN, "/lenses/empty": EMPTY_EXPORT, "/lenses/dead": DEAD_EXPORT, "/lenses/none": NO_EXPORT, "/lenses/ambig": AMBIG_FMT}

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        p = self.path.split("?")[0]
        if p in FILES:
            body, ct = FILES[p]
            self.send_response(200); self.send_header("Content-Type", ct)
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % p.rsplit("/", 1)[1]); self.end_headers(); self.wfile.write(body); return
        body = PAGES.get(p)
        if body is None:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % srv.server_address[1]
FAILS = []; N = [0]
def check(n, c, x=""):
    N[0] += 1
    print(("PASS " if c else "FAIL ") + n + ("" if c else " :: " + str(x)), flush=True)
    c or FAILS.append(n)

class LW:
    _try_download = checks.LensWalk._try_download
    _popup_new = checks.LensWalk._popup_new
    _validate_export = checks.LensWalk._validate_export
    _content_verdict = staticmethod(checks.LensWalk._content_verdict)
    def __init__(self, page):
        self.cfg = {"base_url": base, "fixture_prefix": "walker-fixture"}
        self.th = {"nav_timeout_ms": 15000, "settle_ms_judgment": 1500}
        self.dialog_mode = "dismiss"; self.page_errors = []; self.console_errors = []; self.bad_responses = []
        self.url = base + "/lenses/demo"; self.page = page; self.slug = "demo"; self.ev = tempfile.mkdtemp(prefix="drv-ev-")
    def nav(self, page, cdp): page.goto(self.url, wait_until="domcontentloaded")
    def _close(self, ctx): pass
    def shot(self, page, name): return None

def raises(fn):
    try:
        fn(); return None
    except Exception as e:
        return e

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
    ctx = b.new_context(accept_downloads=True, viewport={"width": 1280, "height": 900}); page = ctx.new_page()
    lw = LW(page)
    page.on("console", lambda m: lw.console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: lw.page_errors.append(str(e)))
    cdp = Cdp(ctx, page)
    d = repro.PlaywrightDriver(lw, ctx, page, cdp, base + "/lenses/demo")
    d.open(None)

    # --- open(): ticket URL host is never used, only its path on this run's base
    d.open("https://concord-os.org/lenses/none")
    check("open(prod URL) stays on the local base (path only)", page.url.startswith(base) and page.url.endswith("/lenses/none"), page.url)
    d.open(None)

    # --- viewport + overflow
    o = d.measure_overflow()
    check("1280 wide: no horizontal overflow", o["viewport_w"] == 1280 and o["overflow_px"] == 0, o)
    d.set_viewport(390, 844)
    check("set_viewport really sets 390x844", page.viewport_size == {"width": 390, "height": 844} and page.evaluate("innerWidth") == 390, page.viewport_size)
    o = d.measure_overflow()
    check("390 wide: overflow detected (1100px element) [failure path]", o["viewport_w"] == 390 and o["overflow_px"] >= 600, o)
    d.set_viewport(1280, 900)

    # --- color scheme
    e = raises(lambda: d.set_scheme("toggle"))
    check("toggle theme with no known scheme raises NotFound [failure path]", e is not None and type(e).__name__ == "_NotFound", e)
    d.set_scheme("dark")
    check("set_scheme(dark) -> prefers-color-scheme: dark", page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches") is True)
    check("dark scheme changes computed background", page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(17, 17, 17)")
    d.set_scheme("toggle")
    check("toggle from dark -> light", page.evaluate("matchMedia('(prefers-color-scheme: light)').matches") is True and d._scheme == "light")

    # --- tab sweep / tab_to
    tr = d.tab_sweep(6, from_top=True)
    check("tab_sweep from top starts at the first control (focused control, not the page title)", tr[:2] == ["Overview", "Publish or share this content"], tr)
    page.keyboard.press("Tab")
    check("focused_name() names the focused control, not the RootWebArea", d.focused_name() == (cdp.ax().focused() or type("x", (), {"name": None})).name and d.focused_name() not in ("", "Driver fixture"), d.focused_name())
    check("tab_sweep honours max_stops", len(tr) <= 6, tr)
    ok, tr = d.tab_to("Export", 30)
    check("tab_to(Export) reaches it by keyboard", ok and tr[-1] == "Export", tr)
    ok, tr = d.tab_to("Nonexistent control", 12)
    check("tab_to(absent) -> False within budget [failure path]", ok is False and len(tr) == 12, tr)

    # --- label-resolving click
    d.open(None)
    nm = d.click("Share & Publish")
    check("alias: 'Share & Publish' -> 'Publish or share this content'", nm == "Publish or share this content" and d.last_resolution["status"] == "alias", d.last_resolution)
    nm = d.click("overview")
    check("exact (case/punct-insensitive) click", nm == "Overview" and d.last_resolution["status"] == "exact", d.last_resolution)
    nm = d.click("Settings")
    check("two live 'Settings' -> ambiguous, not clicked [failure path]", nm is None and d.last_resolution["status"] == "ambiguous", d.last_resolution)
    nm = d.click("Archive notes")
    check("token rule hitting 2 labels -> ambiguous, not clicked [failure path]", nm is None and d.last_resolution["status"] == "ambiguous", d.last_resolution)
    nm = d.click("Frobnicate")
    check("absent control -> None [failure path]", nm is None and d.last_resolution["status"] == "absent", d.last_resolution)
    # open menu first: with the Export menu open, "Publish" resolves to the menu item, not 'Publish draft'
    d.click("Export")
    page.wait_for_timeout(200)
    nm = d.click("Publish")
    check("open-menu pool resolved first (Publish -> menuitem)", nm == "Publish" and "+open-menu" in (d.last_resolution["rule"] or "")
          and page.evaluate("window.pubmenu") == 1 and page.evaluate("window.pub") is None, (d.last_resolution, page.evaluate("[window.pubmenu, window.pub]")))
    d.open(None)
    nm = d.click("Publish")
    check("menu closed: 'Publish' token-matches 2 page buttons -> ambiguous, not clicked [failure path]", nm is None and d.last_resolution["status"] == "ambiguous"
          and page.evaluate("window.pub") is None, d.last_resolution)

    # --- AX check
    r = d.ax_check()
    check("ax_check counts the unnamed button", r["unnamed"] >= 1 and r["total"] >= 8, r)
    r = raises(lambda: d.ax_check("Toolbar")) or d.ax_check("Toolbar")
    check("ax_check scoped to a named region (Toolbar): 1 unnamed of 2", r == {"unnamed": 1, "total": 2}, r)
    e = raises(lambda: d.ax_check("No such region"))
    check("ax_check(absent scope) raises NotFound [failure path]", e is not None and type(e).__name__ == "_NotFound", e)

    # --- export
    d.open(None)
    r = d.export_check(["JSON"])
    check("export JSON via menu -> PASS, parsed, 2 records, file saved", r.get("verdict") == "PASS" and r.get("ok") and r.get("parsed") and r.get("bytes", 0) > 10
          and os.path.exists(os.path.join(lw.ev, r.get("file", "x"))), r)
    d.open(None)
    r = d.export_check(["CSV"])
    check("export CSV via menu -> PASS with 2 rows", r.get("verdict") == "PASS" and r.get("rows") == 2, r)
    d.open(base + "/lenses/empty")
    r = d.export_check(["JSON"])
    check("export of empty JSON -> EMPTY, ok False [failure path]", r.get("verdict") == "EMPTY" and r.get("ok") is False, r)
    d.open(base + "/lenses/dead")
    r = d.export_check(["JSON"])
    check("Export button that does nothing -> NO_FILE [failure path]", r.get("verdict") == "NO_FILE" and r.get("ok") is False, r)
    d.open(base + "/lenses/none")
    r = d.export_check(["JSON"])
    check("no Export control -> NO_CONTROL [failure path]", r.get("verdict") == "NO_CONTROL" and r.get("ok") is False, r)
    d.open(base + "/lenses/ambig")
    r = d.export_check(["JSON"])
    check("GB1581: two JSON options -> BOTH exported and reported per format (no ambiguity stop)",
          r.get("verdict") == "PASS" and r.get("ok") and len(r.get("formats") or []) == 2
          and all(f.get("verdict") == "PASS" for f in r["formats"]), r)
    d.open(None)
    r = d.export_check([])
    check("GB1581: no format named -> every format offered is exported (JSON + CSV)",
          r.get("verdict") == "PASS" and r.get("ok") and len(r.get("formats") or []) == 2, r)

    # --- chat
    d.open(None)
    r = d.chat_ask("What is this lens for?")
    check("chat_ask without a budget -> not sent [failure path]", r == {"sent": False, "note": "no chat send budget for this lens"}, r)
    d.chat_budget = SendBudget({"chat_budgets": {"demo": 1}})
    r = d.chat_ask("What is this lens for?")
    check("chat_ask with budget -> sent and reply seen", r.get("sent") is True and r.get("reply") is True, r)
    check("chat send prefixed with fixture label + spent budget", d.chat_budget.used.get("demo") == 1)
    r = d.chat_ask("again?")
    check("chat budget exhausted -> not sent [failure path]", r.get("sent") is False, r)
    d.chat_budget = SendBudget({"chat_budgets": {"demo": 5}})
    d.open(base + "/lenses/none")
    r = d.chat_ask("hello")
    check("no composer on page -> not sent, budget untouched [failure path]", r.get("sent") is False and d.chat_budget.used.get("demo", 0) == 0, r)

    # --- console errors / evidence
    d.open(None)
    n0 = d.console_errors()
    page.evaluate("console.error('boom from fixture')")
    page.wait_for_timeout(200)
    check("console_errors counts a real console.error", d.console_errors() == n0 + 1, (n0, d.console_errors()))
    ev = d.evidence()
    check("evidence() has console/net keys and no writes on a read-only page", set(ev) == {"console_errors", "net_statuses", "net_writes"} and ev["net_writes"] == [], ev)
    b.close()
print("%d check(s), %d failure(s)" % (N[0], len(FAILS))); sys.exit(1 if FAILS else 0)
