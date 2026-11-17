#!/usr/bin/env python3
"""Real-Chromium checks of the PlaywrightDriver code added by ULW pass 2 (expected checks + typed values + write flows):
net_mark/net_since (per-step net window), popup_count, focus_in_popup, type_value (literal / empty / 300 chars),
fill_label_field, find_submit, delete_with_confirm (in-page confirm + native confirm() + no confirm), click_first,
snapshot(list_items / alerts / aria-invalid), reload read-back, and run_repro end to end (validation blocked / validation
NOT blocked / create+cleanup / value persists / confirm before delete / refusals). Failure paths next to every feature.

Local 127.0.0.1 fixture server only - never prod, no accounts. Needs Playwright + Chromium (the walker box); where
playwright is absent the file SKIPs (exit 0) so it stays importable on a bare machine.
Run on the box:  <venv>/bin/python selftest/test_driver_write_playwright.py <walker dir>"""
import http.server, json, os, sys, tempfile, threading, time

WALKER = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, WALKER)
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("SKIP: playwright is not installed here - run this selftest on the walker box")
    sys.exit(0)
from concord_walker import repro, checks
from concord_walker.cdp import Cdp

# One page template; `mode` flags change the behaviour of each variant (all served from this process).
PAGE = """<!doctype html><html><head><title>Write fixture</title></head><body>
<h1>Items</h1>
<button id="new">New item</button>
<button id="pub">Publish report</button>
<ul aria-label="Items" id="list"></ul>
<div id="dlg" role="dialog" aria-modal="true" aria-label="New item form" hidden>
  <label>Title <input id="title" type="text" aria-label="Title"></label>
  <label>Amount <input id="amount" type="number" aria-label="Amount"></label>
  <label>Password <input id="pw" type="password" aria-label="Password"></label>
  <div id="msg" role="alert"></div>
  <button id="create">Create</button><button id="cancel">Cancel</button>
</div>
<div id="cf" role="alertdialog" aria-label="Confirm delete" hidden><p>Delete this item? This cannot be undone.</p><button id="cf-yes">Delete</button><button id="cf-no">Cancel delete</button></div>
<script>
var MODE = "__MODE__";
var rows = [];
function render(){
  var ul = document.getElementById('list'); ul.innerHTML = '';
  rows.forEach(function(r, i){
    var li = document.createElement('li');
    var s = document.createElement('span'); s.textContent = r; li.appendChild(s);
    var b = document.createElement('button'); b.textContent = 'Delete'; b.setAttribute('aria-label', 'Delete');
    b.onclick = function(){ del(i); }; li.appendChild(b); ul.appendChild(li);
  });
}
function del(i){
  if (MODE === 'native') { if (!confirm('Delete this item?')) return; rows.splice(i, 1); fetch('/api/items', {method: 'DELETE'}); render(); return; }
  if (MODE === 'noconfirm') { rows.splice(i, 1); fetch('/api/items', {method: 'DELETE'}); render(); return; }
  var cf = document.getElementById('cf'); cf.hidden = false;
  document.getElementById('cf-yes').onclick = function(){ rows.splice(i, 1); fetch('/api/items', {method: 'DELETE'}); cf.hidden = true; render(); };
  document.getElementById('cf-no').onclick = function(){ cf.hidden = true; };
}
function load(){ if (MODE === 'volatile') { rows = ['someone-elses-row']; render(); return; }
  fetch('/api/items?mode=' + MODE).then(function(r){ return r.json(); }).then(function(j){ rows = j; render(); }); }
document.getElementById('new').onclick = function(){ document.getElementById('dlg').hidden = false; document.getElementById('title').focus(); };
document.getElementById('cancel').onclick = function(){ document.getElementById('dlg').hidden = true; document.getElementById('new').focus(); };
document.addEventListener('keydown', function(e){
  var dlg = document.getElementById('dlg');
  if (dlg.hidden) return;
  if (e.key === 'Escape') { dlg.hidden = true; document.getElementById('new').focus(); return; }
  if (e.key === 'Tab') {   // trap
    var f = dlg.querySelectorAll('input,button'); var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
document.getElementById('create').onclick = function(){
  var t = document.getElementById('title'), a = document.getElementById('amount'), m = document.getElementById('msg');
  var bad = (a.value !== '' && Number(a.value) <= 0) || t.value.trim() === '';
  if (bad && MODE !== 'noval') { m.textContent = 'Amount must be greater than 0'; a.setAttribute('aria-invalid', 'true'); return; }
  m.textContent = ''; a.removeAttribute('aria-invalid');
  fetch('/api/items?mode=' + MODE, {method: 'POST', body: t.value}).then(function(){ rows.push(t.value); render(); document.getElementById('dlg').hidden = true; t.value = ''; a.value = ''; });
};
load();
</script></body></html>"""

STORE = {}


class H(http.server.BaseHTTPRequestHandler):
    def _mode(self):
        return (self.path.split("mode=")[1].split("&")[0] if "mode=" in self.path else "std")

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/items":
            rows = STORE.setdefault(self._mode(), ["someone-elses-row"])
            body = json.dumps(rows).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body); return
        if p.startswith("/lenses/"):
            mode = p.rsplit("/", 1)[1]
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(PAGE.replace("__MODE__", mode).encode()); return
        self.send_response(404); self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode() if n else ""
        STORE.setdefault(self._mode(), ["someone-elses-row"]).append(body)
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b"{}")

    def do_DELETE(self):
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b"{}")

    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % srv.server_address[1]
FAILS = []
N = [0]


def check(n, c, x=""):
    N[0] += 1
    print(("PASS " if c else "FAIL ") + n + ("" if c else " :: " + str(x)), flush=True)
    c or FAILS.append(n)


class LW:
    def __init__(self, page, slug):
        self.cfg = {"base_url": base, "fixture_prefix": "qa-walker"}
        self.th = {"nav_timeout_ms": 15000, "settle_ms_judgment": 1500}
        self.dialog_mode = "dismiss"; self.page_errors = []; self.console_errors = []; self.bad_responses = []; self.native_dialogs = []
        self.url = base + "/lenses/" + slug; self.page = page; self.slug = slug; self.ev = tempfile.mkdtemp(prefix="wdrv-ev-")
        page.on("dialog", self._on_dialog)

    def _on_dialog(self, d):
        self.native_dialogs.append({"type": d.type, "msg": d.message[:80], "t": time.time()})
        (d.accept() if self.dialog_mode == "accept" else d.dismiss())

    def nav(self, page, cdp): page.goto(self.url, wait_until="domcontentloaded"); page.wait_for_timeout(300)
    def _close(self, ctx): pass
    def shot(self, page, name): return None


def raises(fn):
    try:
        fn(); return None
    except Exception as e:
        return e


WRITE = dict(allow_write=True, admin=False, write_skip=False, account="t1", label_base="qa-walker-form-t1-abc-fix1", fixtures=lambda: [])


def mk(pw_browser, mode):
    STORE.pop(mode, None)
    ctx = pw_browser.new_context(viewport={"width": 1280, "height": 900}); page = ctx.new_page()
    lw = LW(page, mode)
    page.on("console", lambda m: lw.console_errors.append(m.text) if m.type == "error" else None)
    d = repro.PlaywrightDriver(lw, ctx, page, Cdp(ctx, page), lw.url)
    d.open(None)
    page.wait_for_timeout(300)
    return d, lw, page, ctx


def run(drv, steps, expected, write=None, lens="std"):
    fx = []
    w = dict(WRITE if write is None else write)
    w["on_fixture"] = lambda l, st, note: fx.append((l, st))
    r = repro.run_repro({"id": "FIX-w-001", "lens": lens, "repro_steps": steps, "expected": expected}, drv, lens_slug=lens, write=w)
    return r, fx


with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])

    # ------------------------------------------------------------------ per-step net window, popups, focus trap
    d, lw, page, ctx = mk(b, "std")
    m0 = d.net_mark()
    check("net window empty before any write", d.net_since(m0) == [])
    check("popup_count 0 with nothing open", d.popup_count() == 0, d.popup_count())
    d.click("New item")
    page.wait_for_timeout(200)
    check("popup_count 1 once the form dialog is open", d.popup_count() >= 1, d.popup_count())
    ok = []
    for _ in range(4):
        d.press("Tab"); page.wait_for_timeout(60); ok.append(d.focus_in_popup())
    check("focus_in_popup True on every Tab press while the trap holds", all(ok) and len(ok) == 4, ok)
    d.press("Escape"); page.wait_for_timeout(150)
    check("Escape closes the dialog: popup_count back to 0", d.popup_count() == 0, d.popup_count())
    check("focus_in_popup False once nothing is open (not a vacuous True) [failure path]", d.focus_in_popup() is False)
    check("focused_name returns to the opener after Escape", d.focused_name() == "New item", d.focused_name())

    # ------------------------------------------------------------------ type_value / fill_label_field / find_submit
    d.click("New item"); page.wait_for_timeout(150)
    check("type_value literal -5 into Amount", d.type_value("Amount", "-5") and page.input_value("#amount") == "-5", page.input_value("#amount"))
    check("type_value '' clears the field", d.type_value("Amount", "") and page.input_value("#amount") == "")
    long = "qa-walker-x-" + "x" * 288
    check("type_value 300 chars lands exactly", d.type_value("Title", long) and len(page.input_value("#title")) == 300, len(page.input_value("#title")))
    check("type_value into an absent field -> False [failure path]", d.type_value("No such field", "1") is False)
    check("find_submit: ONE enabled Create control in the open dialog", d.find_submit("create") == "Create", d.find_submit("create"))
    check("find_submit: no such verb -> None [failure path]", d.find_submit("publish") is None)
    d.type_value("Title", "")
    got = d.fill_label_field("qa-walker-lbl-1", ["Amount"])
    check("fill_label_field fills the empty Title with the label", got == "Title" and page.input_value("#title") == "qa-walker-lbl-1", (got, page.input_value("#title")))
    page.fill("#title", "")
    check("fill_label_field never fills a field the ticket typed into (avoid=Title): the only other field is Password -> None [failure path]",
          d.fill_label_field("qa-walker-lbl-2", ["Title"]) is None and page.input_value("#title") == "", page.input_value("#title"))
    d.press("Escape"); page.wait_for_timeout(100)
    check("find_submit with the dialog closed -> None [failure path]", d.find_submit("create") is None)
    ctx.close()

    # ------------------------------------------------------------------ snapshot: alerts / aria-invalid / list_items
    d, lw, page, ctx = mk(b, "std")
    d.click("New item"); page.wait_for_timeout(150)
    d.type_value("Amount", "-5"); d.type_value("Title", "qa-walker-snap")
    mark = d.net_mark()
    d.click("Create"); page.wait_for_timeout(300)
    sn = d.snapshot()
    check("blocked submit: net window has NO write", d.net_since(mark) == [], d.net_since(mark))
    check("snapshot.alerts carries the inline message", any("greater than 0" in a for a in sn["alerts"]), sn["alerts"])
    check("snapshot controls expose aria-invalid on Amount", any(c["name"] == "Amount" and (c["props"].get("invalid") in (True, "true")) for c in sn["controls"]), [c for c in sn["controls"] if c["name"] == "Amount"])
    check("snapshot.list_items holds the foreign row but not the blocked one", "someone-elses-row" in " ".join(sn["list_items"]) and "qa-walker-snap" not in " ".join(sn["list_items"]), sn["list_items"])
    d.type_value("Amount", "5")
    mark = d.net_mark()
    d.click("Create"); page.wait_for_timeout(500)
    w = d.net_since(mark)
    sn = d.snapshot()
    check("valid submit: the POST is in the net window", any(x.startswith("POST") for x in w), w)
    check("created row appears INSIDE the list container", any("qa-walker-snap" in x for x in sn["list_items"]), sn["list_items"])
    ctx.close()

    # ------------------------------------------------------------------ delete_with_confirm: in-page, native, none, foreign
    for mode, want_confirm in (("std", True), ("native", True), ("noconfirm", False)):
        d, lw, page, ctx = mk(b, mode)
        d.click("New item"); page.wait_for_timeout(150)
        d.type_value("Title", "qa-walker-del-1"); d.click("Create"); page.wait_for_timeout(500)
        r = d.delete_with_confirm("qa-walker-del-1")
        page.wait_for_timeout(300)
        check("delete_with_confirm[%s]: hit + confirm=%s + row present until confirmed + removed" % (mode, want_confirm),
              r.get("hit") and r.get("confirm") is want_confirm and r.get("removed") is True and (r.get("row_present") is True or not want_confirm), r)
        check("delete_with_confirm[%s]: the foreign row survives" % mode, any("someone-elses-row" in x for x in d.snapshot()["list_items"]), d.snapshot()["list_items"])
        ctx.close()
    d, lw, page, ctx = mk(b, "std")
    r = d.delete_with_confirm("not-a-row-on-this-page")
    check("delete_with_confirm on an absent label -> no hit, nothing clicked [failure path]", not r.get("hit"), r)
    r = d.delete_with_confirm("someone-elses-row")
    check("(the executor never passes a foreign label; the driver is row-scoped to WHATEVER label it is given)", r.get("hit") is not None)
    ctx.close()

    # ------------------------------------------------------------------ click_first
    d, lw, page, ctx = mk(b, "std")
    nm = d.click_first("item row")
    check("click_first opens the first safe row-ish control, never 'Publish report'", nm is None or "Publish" not in nm, nm)
    ctx.close()

    # ------------------------------------------------------------------ run_repro end to end
    # 1. validation BLOCKED by the app -> FIXED, no write in the typed/submit windows
    d, lw, page, ctx = mk(b, "std")
    r, fx = run(d, ["New item", "Type -5 in Amount", "Create"], "Inline error message", lens="std")
    check("e2e validation blocked: FIXED on a machine-checked inline message + no write", r["verdict"] == "FIXED", (r["verdict"], r["notes"]))
    wins = [s for s in r["steps"] if s["action"] == "type_value"]
    check("e2e: typed value recorded in the step record", wins and wins[0].get("typed") == "-5", r["steps"])
    ctx.close()
    # 2. validation NOT enforced by the app -> the write is caught -> STILL_FAILING, and the created fixture is cleaned up
    d, lw, page, ctx = mk(b, "noval")
    r, fx = run(d, ["New item", "Type -5 in Amount", "Create"], "Inline error message", lens="noval")
    check("e2e invalid value written to the API: STILL_FAILING (never a pass)", r["verdict"] == "STILL_FAILING" and "reached the API" in r["notes"], (r["verdict"], r["notes"]))
    check("e2e: the fixture it created is deleted, foreign row untouched", all(v == "deleted" for v in (r.get("fixtures") or {}).values()) and any("someone-elses-row" in x for x in d.snapshot()["list_items"]), (r.get("fixtures"), d.snapshot()["list_items"]))
    ctx.close()
    # 3. create + appears in list + cleanup
    d, lw, page, ctx = mk(b, "std")
    r, fx = run(d, ["New item", "fill", "submit"], "Task appears in the list", lens="std")
    check("e2e create: label typed, submitted, found INSIDE the list -> FIXED", r["verdict"] == "FIXED", (r["verdict"], r["notes"]))
    check("e2e create: fixture deleted at the end, lifecycle recorded", [s for _, s in fx][-1] == "deleted" and "deleted" in str(r.get("fixtures")), (fx, r.get("fixtures")))
    ctx.close()
    # 4. value persists after a reload (server-backed) vs volatile (not persisted -> own label missing after reload)
    d, lw, page, ctx = mk(b, "std")
    r, _ = run(d, ["New item", "fill", "submit", "Hard reload"], "Saved value persists", lens="std")
    check("e2e persisted: own label present in the post-reload read-back -> FIXED", r["verdict"] == "FIXED", (r["verdict"], r["notes"]))
    ctx.close()
    d, lw, page, ctx = mk(b, "volatile")
    r, _ = run(d, ["New item", "fill", "submit", "Hard reload"], "Saved value persists", lens="volatile")
    check("e2e volatile page (value gone after reload) -> STILL_FAILING [failure path]", r["verdict"] == "STILL_FAILING", (r["verdict"], r["notes"]))
    ctx.close()
    # 5. confirm before delete (in-page) / no confirm
    d, lw, page, ctx = mk(b, "std")
    r, _ = run(d, ["New item", "fill", "submit", "Delete the created item when done"], "Confirm dialog", lens="std")
    check("e2e delete asks to confirm before removing the own row -> FIXED", r["verdict"] == "FIXED", (r["verdict"], r["notes"]))
    ctx.close()
    d, lw, page, ctx = mk(b, "noconfirm")
    r, _ = run(d, ["New item", "fill", "submit", "Delete the created item when done"], "Confirm dialog", lens="noconfirm")
    check("e2e delete with NO confirm -> STILL_FAILING [failure path]", r["verdict"] == "STILL_FAILING", (r["verdict"], r["notes"]))
    ctx.close()
    # 6. Escape closes the open dialog, focus returns to the opener, focus trapped
    d, lw, page, ctx = mk(b, "std")
    r, _ = run(d, ["New item", "Tab", "Tab", "Escape"], "Esc closes the dialog; focus returns to the trigger; focus trapped", lens="std")
    check("e2e Escape: closes (popups 1 -> 0), focus returns to the opener, focus stayed in the dialog -> FIXED", r["verdict"] == "FIXED", (r["verdict"], r["notes"]))
    ctx.close()
    # 7. refusals reach the page as nothing happening
    d, lw, page, ctx = mk(b, "std")
    r, _ = run(d, ["New item", "Type 0 in Password"], "Inline error message", lens="std")
    check("e2e password field refused: nothing typed into it", r["verdict"] == "NEEDS_HUMAN" and page.input_value("#pw") == "" and "never typed into" in r["notes"], (r["notes"], page.input_value("#pw")))
    r, _ = run(d, ["New item", "Type -5 in Amount"], "Inline error message", write=dict(WRITE, allow_write=False), lens="std")
    check("e2e without --allow-write: refused, the form was not even opened", r["verdict"] == "NEEDS_HUMAN" and "--allow-write" in r["notes"], r["notes"])
    ctx.close()
    b.close()
print("%d check(s), %d failure(s)" % (N[0], len(FAILS)))
sys.exit(1 if FAILS else 0)
