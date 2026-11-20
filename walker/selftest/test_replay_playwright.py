#!/usr/bin/env python3
"""Real-Chromium check of PlaywrightDriver.tab_names / focus_role / click_in_row / delete_fixture
against a local static page (127.0.0.1 only, never prod). Failure paths included."""
import http.server, os, sys, threading
WALKER = sys.argv[1]
sys.path.insert(0, WALKER)
from concord_walker import repro
from concord_walker.cdp import Cdp
from playwright.sync_api import sync_playwright

PAGE = b"""<!doctype html><html><body>
<div role="tablist"><button role="tab">Overview</button><button role="tab">Details</button><button role="tab">History</button></div>
<input aria-label="Search notes" type="search">
<ul id="list">
 <li><span>walker-fixture-AAA note</span> <button onclick="this.parentNode.remove()">Delete</button> <button onclick="window.clicked='edit-aaa'">Edit</button></li>
 <li><span>walker-fixture-BBB note</span> <button onclick="if(confirm('Delete BBB?')) this.parentNode.remove()">Delete</button></li>
 <li><span>walker-fixture-CCC note</span> <button onclick="document.getElementById('dlg').hidden=false">Remove</button></li>
 <li><span>walker-fixture-DDD note</span> <button>Delete</button> <button>Delete</button></li>
 <li><span>someone-elses note</span> <button onclick="this.parentNode.remove()">Delete</button></li>
 <li><span>walker-fixture-EEE note</span> <button onclick="0">Delete</button></li>
</ul>
<div id="dlg" role="dialog" aria-label="Confirm" hidden><button onclick="document.getElementById('dlg').hidden=true">Cancel</button>
<button onclick="var l=[...document.querySelectorAll('li')].find(x=>x.textContent.includes('CCC'));l&&l.remove();document.getElementById('dlg').hidden=true">Remove</button></div>
<div id="edited"></div>
</body></html>"""

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(PAGE)
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % srv.server_address[1]
FAILS = []
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else " " + str(x)), flush=True)
    c or FAILS.append(n)

class LW:
    def __init__(self, page):
        self.cfg = {"base_url": base}; self.th = {"nav_timeout_ms": 15000, "settle_ms_judgment": 1500}
        self.dialog_mode = "dismiss"; self.page_errors = []; self.console_errors = []; self.url = base + "/lenses/demo"; self.page = page
    def nav(self, page, cdp): page.goto(self.url, wait_until="domcontentloaded")
    def _close(self, ctx): pass
    def shot(self, page, name): return None

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
    ctx = b.new_context(); page = ctx.new_page()
    lw = LW(page)
    page.on("dialog", lambda d: d.accept() if lw.dialog_mode == "accept" else d.dismiss())
    cdp = Cdp(ctx, page)
    d = repro.PlaywrightDriver(lw, ctx, page, cdp, base + "/lenses/demo")
    d.open(None)
    names = lambda: [n.name for n in cdp.ax().live()]
    has = lambda s: any(s in (x or "") for x in names())
    check("tab_names lists the three tabs in order", d.tab_names() == ["Overview", "Details", "History"], d.tab_names())
    check("focus_role(tab) focuses the first tab", d.focus_role("tab") == "Overview" and (cdp.ax().focused() or object()).__dict__ if False else d.focus_role("tab") == "Overview")
    f = cdp.ax().focused(); check("focused node really is the Overview tab", f is not None and f.name == "Overview", f)
    check("focus_role(searchbox) focuses the search field", d.focus_role("searchbox") == "Search notes")
    check("focus_role(absent role) -> None", d.focus_role("slider") is None)
    check("click_in_row Edit in AAA row clicks it", d.click_in_row("Edit", "walker-fixture-AAA") == "Edit" and page.evaluate("window.clicked") == "edit-aaa")
    check("click_in_row ambiguous (two Deletes in DDD row) -> None", d.click_in_row("Delete", "walker-fixture-DDD") is None)
    check("click_in_row absent label -> None", d.click_in_row("Delete", "walker-fixture-ZZZ") is None)
    check("click_in_row absent control -> None", d.click_in_row("Archive", "walker-fixture-AAA") is None)
    check("delete_fixture plain row delete -> True, AAA gone", d.delete_fixture("walker-fixture-AAA") is True and not has("walker-fixture-AAA"))
    check("dialog_mode restored to dismiss", lw.dialog_mode == "dismiss")
    check("delete_fixture with native confirm() -> True, BBB gone", d.delete_fixture("walker-fixture-BBB") is True and not has("walker-fixture-BBB"))
    check("delete_fixture with in-page confirm dialog (Remove) -> True, CCC gone", d.delete_fixture("walker-fixture-CCC") is True and not has("walker-fixture-CCC"), names())
    check("delete_fixture ambiguous row -> False, DDD kept", d.delete_fixture("walker-fixture-DDD") is False and has("walker-fixture-DDD"))
    check("delete_fixture no-op button -> False (label still there)", d.delete_fixture("walker-fixture-EEE") is False and has("walker-fixture-EEE"))
    check("someone else's row untouched", has("someone-elses note"))
    check("dialog_mode still dismiss at end", lw.dialog_mode == "dismiss")
    b.close()
print("%d failure(s)" % len(FAILS)); sys.exit(1 if FAILS else 0)
