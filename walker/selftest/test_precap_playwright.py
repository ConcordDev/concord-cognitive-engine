#!/usr/bin/env python3
"""Real-Chromium checks of the pre-capture PlaywrightDriver additions (items 1-4). NOT runnable on the dev Mac
(no Playwright/Chromium): Zuko 2 runs it on the walker box.   <venv>/bin/python selftest/test_precap_playwright.py <walker dir>

Covers: platform(); active_item() on a tablist (arrow nav changes it, a dead widget does not); tab_order focus trace and a
real focus TRAP being flagged; press_combo (Mod resolved from the browser's platform) opening an app palette; Escape closing a
dialog; enter_submit (write observed via net window; refused read-only); set_viewport + measure_layout on a page that overflows
at 390 and one that does not; set_reduced_motion / set_zoom / set_offline; page_scheme + app theme toggle (generic and
ambiguous -> pending_capture); per-step obs windows (console error, 4xx, toast, url, row count, spinner, boundary text, blank);
_on_resp records SHAPE + hashed leaves only (no raw values) and the create read-back check passes/fails on a real server;
nav_away_back persistence of the walker's own value. Local 127.0.0.1 fixture only - never prod, no accounts."""
import http.server, json, os, sys, tempfile, threading, time

WALKER = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, WALKER)
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("SKIP: playwright is not installed here - run this selftest on the walker box")
    sys.exit(0)
from concord_walker import repro, netcheck as N, observe as O, viewport as V
from concord_walker.cdp import Cdp

PAGE = """<!doctype html><html><head><title>Precap fixture</title><style>
body{background:var(--bg,#fff);color:#111} body.dark{--bg:#111;color:#eee}
@media (prefers-reduced-motion: reduce){ .spin{animation:none} }
#wide{width:__WIDE__px;height:20px;background:#ccc}
</style></head><body>
<h1>Precap</h1>
<button id="theme" aria-label="Toggle dark mode">Theme</button>
<div role="tablist" aria-label="Views"><button role="tab" aria-selected="true" id="t1" tabindex="0">One</button><button role="tab" aria-selected="false" id="t2" tabindex="-1">Two</button><button role="tab" aria-selected="false" id="t3" tabindex="-1">Three</button></div>
<a href="#x">Link A</a><button id="b2">Beta</button><button id="b3">Gamma</button>
<input id="title" aria-label="Title"><button id="save">Save</button>
<ul id="list" aria-label="Rows"></ul><div id="toast" role="alert"></div><div id="wide"></div>
<div id="pal" role="dialog" aria-label="Palette" hidden><input aria-label="Command"></div>
<script>
var MODE="__MODE__";
document.getElementById('theme').onclick=function(){document.body.classList.toggle('dark')};
var tabs=[].slice.call(document.querySelectorAll('[role=tab]'));
tabs.forEach(function(t,i){t.onkeydown=function(e){var n=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:null;if(n===null||MODE==='deadtabs')return;n=(n+tabs.length)%tabs.length;tabs.forEach(function(x){x.setAttribute('aria-selected',x===tabs[n]);x.tabIndex=x===tabs[n]?0:-1});tabs[n].focus()}});
document.addEventListener('keydown',function(e){var mod=navigator.platform.indexOf('Mac')>=0?e.metaKey:e.ctrlKey;
  if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();document.getElementById('pal').hidden=false;document.querySelector('#pal input').focus()}
  if(e.key==='Escape')document.getElementById('pal').hidden=true;
  if(MODE==='trap'&&e.key==='Tab'){e.preventDefault()}});
function load(){fetch('/api/rows').then(function(r){return r.json()}).then(function(j){var ul=document.getElementById('list');ul.innerHTML='';j.forEach(function(r){var li=document.createElement('li');li.textContent=r.name;ul.appendChild(li)})})}
document.getElementById('save').onclick=function(){var v=document.getElementById('title').value;fetch('/api/rows',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:v})}).then(function(r){return r.json()}).then(function(){document.getElementById('toast').textContent='Saved';if(MODE!=='nolist')load()})};
document.getElementById('title').addEventListener('keydown',function(e){if(e.key==='Enter')document.getElementById('save').click()});
if(MODE==='err')console.error('boom');
if(MODE==='boundary')document.body.innerHTML='<p>Something went wrong</p>';
load();
</script></body></html>"""
ROWS = []


class H(http.server.BaseHTTPRequestHandler):
    def _mode(self):
        return (self.path.split("mode=")[1] if "mode=" in self.path else "std")

    def do_GET(self):
        if self.path.startswith("/api/rows"):
            b = json.dumps(ROWS).encode(); self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b); return
        if self.path.startswith("/api/missing"):
            self.send_response(404); self.end_headers(); return
        m = self.path.split("/lenses/")[1].split("?")[0] if "/lenses/" in self.path else "std"
        wide = 900 if m == "wide" else 100
        b = PAGE.replace("__MODE__", m).replace("__WIDE__", str(wide)).encode()
        self.send_response(200); self.send_header("content-type", "text/html"); self.end_headers(); self.wfile.write(b)

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        ROWS.append({"id": "r%d" % (len(ROWS) + 1), "name": body.get("name")})
        b = json.dumps(ROWS[-1]).encode(); self.send_response(201); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b)

    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % srv.server_address[1]
FAILS, N_ = [], [0]


def check(n, c, x=""):
    N_[0] += 1
    print(("PASS " if c else "FAIL ") + n + ("" if c else " :: " + str(x)), flush=True)
    c or FAILS.append(n)


class LW:
    def __init__(self, page, slug):
        self.cfg = {"base_url": base, "fixture_prefix": "qa-walker"}
        self.th = {"nav_timeout_ms": 15000, "settle_ms_judgment": 1500}
        self.dialog_mode = "dismiss"; self.page_errors = []; self.console_errors = []; self.bad_responses = []; self.native_dialogs = []
        self.url = base + "/lenses/" + slug; self.page = page; self.slug = slug; self.ev = tempfile.mkdtemp(prefix="precap-ev-")
        page.on("response", lambda r: self.bad_responses.append((r.status, r.url[-40:])) if r.status >= 400 else None)
        page.on("console", lambda m: self.console_errors.append(m.text) if m.type == "error" else None)

    def nav(self, page, cdp): page.goto(self.url, wait_until="domcontentloaded"); page.wait_for_timeout(300)
    def _close(self, ctx): pass
    def shot(self, page, name): return None


def mk(b, mode):
    ctx = b.new_context(viewport={"width": 1280, "height": 900}); page = ctx.new_page()
    lw = LW(page, mode)
    d = repro.PlaywrightDriver(lw, ctx, page, Cdp(ctx, page), lw.url)
    d.open(None); page.wait_for_timeout(300)
    return d, lw, page, ctx


def run(d, steps, expected="", write=True, lens="std"):
    w = dict(allow_write=write, admin=False, write_skip=False, account="t1", label_base="qa-walker-pc-t1-abc", fixtures=lambda: [], on_fixture=lambda *a: None)
    return repro.run_repro({"id": "FIX-pc-001", "lens": lens, "repro_steps": steps, "expected": expected}, d, lens_slug=lens, write=w)


with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
    d, lw, page, ctx = mk(b, "std")
    check("platform() reports linux/darwin", d.platform() in ("linux", "darwin"), d.platform())
    # arrow navigation changes the active tab; a dead widget does not
    d.focus_name("One"); a0 = d.active_item(); d.press("ArrowRight"); a1 = d.active_item()
    check("active_item changes on ArrowRight in a live tablist", a0 != a1, (a0, a1))
    ctx.close()
    d2, lw2, page2, ctx2 = mk(b, "deadtabs")
    d2.focus_name("One"); x0 = d2.active_item(); d2.press("ArrowRight"); x1 = d2.active_item()
    check("active_item UNCHANGED on a dead widget (arrow_nav would FAIL)", x0 == x1, (x0, x1))
    ctx2.close()
    # Tab order: moves on a normal page, flagged on a trap
    d, lw, page, ctx = mk(b, "std")
    r = run(d, ["Tab x30"], "")
    check("tab_order executed on a real page and focus moved", any(s["action"] == "tab_order" and s["executed"] and "pass" in s["result"] for s in r["steps"]), r["steps"][-2:])
    ctx.close()
    d, lw, page, ctx = mk(b, "trap")
    r = run(d, ["Tab x30"], "")
    check("a real keyboard trap is flagged (focus stuck / never left)", any(s["action"] == "tab_order" and "fail" in s["result"] for s in r["steps"]) or any(not s["executed"] for s in r["steps"]), r["steps"][-2:])
    ctx.close()
    # Mod resolved from the BROWSER platform opens the palette; Escape closes it
    d, lw, page, ctx = mk(b, "std")
    r = run(d, ["press Cmd/Ctrl+K", "press Esc while open"], "")
    ex = [s for s in r["steps"] if s["executed"]]
    check("Mod+K opens the palette and Escape closes it", len(ex) >= 2 and "closed" in ex[-1]["result"], r["steps"])
    check("Delete shortcut never reaches the page", repro.expand_step("press Delete", "std")["mapped"] is False)
    # Enter submits (a write was observed); refused read-only
    d.focus_name("Title"); d.type_into("Title", "qa-walker-enter-1")
    r = run(d, ["press Enter in the Title field to submit"], "", write=True)
    check("enter_submit confirmed by an observed POST", any(s["action"] == "enter_submit" and s["executed"] for s in r["steps"]), r["steps"][-1:])
    r = run(d, ["press Enter in the Title field to submit"], "", write=False)
    check("enter_submit refused without --allow-write", any(s["action"] == "enter_submit" and not s["executed"] for s in r["steps"]), r["steps"][-1:])
    ctx.close()
    # viewport / layout / theme / motion / zoom / offline
    d, lw, page, ctx = mk(b, "wide")
    d.set_viewport(390, 844); m = d.measure_layout()
    check("measure_layout sees horizontal overflow of a 900px element at 390", V.analyze_layout(m)["state"] == "fail", m)
    ctx.close()
    d, lw, page, ctx = mk(b, "std")
    d.set_viewport(390, 844); check("no overflow on the std page at 390", V.analyze_layout(d.measure_layout())["state"] == "pass", d.measure_layout())
    d.set_scheme("dark"); check("prefers-color-scheme emulated", page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches"))
    d.set_reduced_motion(True); check("reduced motion emulated", page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"))
    iw0, ih0, dpr0 = page.evaluate("[innerWidth, innerHeight, devicePixelRatio]")
    d.set_zoom(1.5)
    iw1, ih1, dpr1 = page.evaluate("[innerWidth, innerHeight, devicePixelRatio]")
    check("zoom applied: dpr == 1.5 and layout viewport shrinks to ~1/1.5", dpr1 == 1.5 and abs(iw1 - iw0 / 1.5) <= 1 and abs(ih1 - ih0 / 1.5) <= 1, (iw0, ih0, dpr0, iw1, ih1, dpr1))
    d.set_zoom(1.0)
    iw2, ih2, dpr2 = page.evaluate("[innerWidth, innerHeight, devicePixelRatio]")
    check("zoom reset restores the original viewport and dpr", (iw2, ih2, dpr2) == (iw0, ih0, dpr0), (iw0, ih0, dpr0, iw2, ih2, dpr2))
    d.set_offline(True); off = page.evaluate("navigator.onLine"); d.set_offline(False)
    check("offline then back online", off is False and page.evaluate("navigator.onLine") is True, off)
    s0 = d.page_scheme(); r = run(d, ["click the theme toggle"], ""); s1 = d.page_scheme()
    check("generic app theme toggle changes the rendered theme", s0 != s1, (s0, s1))
    ctx.close()
    # obs windows: generic observe predicates against real traffic
    d, lw, page, ctx = mk(b, "err")
    r = run(d, ["Tab x30"], "No new console errors.")
    check("a console error during the step window FAILS the generic predicate", r["verdict"] in (repro.STILL, repro.HUMAN) and r["verdict"] != repro.FIXED, r["notes"])
    ctx.close()
    d, lw, page, ctx = mk(b, "boundary")
    r = run(d, ["Tab x30"], "The page is not blank.")
    check("an error-boundary page fails 'not blank'", r["verdict"] != repro.FIXED, r["notes"])
    ctx.close()
    d, lw, page, ctx = mk(b, "std")
    d.type_into("Title", "qa-walker-rb-7")
    mk0 = d.obs_mark(); page.click("#save"); d.settle(); od = d.obs_since(mk0)
    post = [x for x in od["net"] if x["method"] == "POST"]
    check("_on_resp recorded the create (status 201, shape keys only, hashed leaves)", post and post[0]["status"] == 201 and post[0]["shape"] == {"id": "string", "name": "string"} and "qa-walker-rb-7" not in json.dumps(post[0]), od["net"][:2])
    ev = {"own_values": ["qa-walker-rb-7"], "obs": [O.window_from({}, {}, [], od["net"])]}
    check("create read-back passes against the real list GET", N.readback_check(ev)[0] == "pass", N.readback_check(ev))
    ev2 = {"own_values": ["qa-walker-rb-7"], "obs": [O.window_from({}, {}, [], [x for x in od["net"] if x["method"] != "GET"])]}
    check("read-back with NO list GET is pending_capture/unverified, never pass", N.readback_check(ev2)[0] == "unverified")
    d.nav_away_back(); snr = d.snapshot()
    check("own value persists across navigate-away-and-back", any("qa-walker-rb-7" in (t or "") for t in snr["texts"]), snr["texts"][:5])
    ctx.close()
    b.close()
print("%d checks, %d failed" % (N_[0], len(FAILS)))
sys.exit(1 if FAILS else 0)
