#!/usr/bin/env python3
"""Offline self-test for WALK-04a (form bad-input recipes, GB-1544).

Self-contained: serves its own fake lenses (a buggy form, a fixed form, a
5xx form, and a formless page) and drives the Reverifier in-process, so it
needs no edits to fixture_app.py and no live site. On the pristine walker the
validation tickets classify away to NEEDS_HUMAN and every assertion below
fails; after WALK-04a they must read: buggy STILL_FAILING, fixed FIXED,
5xx NEEDS_HUMAN (clean fail), formless NEEDS_HUMAN, signed-out NEEDS_HUMAN,
and the records the buggy form created with bad values are cleaned up by
value (blank-titled ones are leftover-logged, never deleted by position).

Run with the walker's venv python:  .venv/bin/python selftest/run_selftest_formfuzz.py
"""
import json, os, re, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)

STATE = {"auth_off": False}
STORES = {"buggy": [], "fixed": []}

FORM_PAGE = """<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#111;color:#eee;font:16px sans-serif;margin:0;padding:8px}
dialog{background:#222;color:#eee} button{margin:4px;padding:8px}</style></head><body>
<h1>%s lens</h1>
<button id=newb onclick="openD()">New item</button>
<ul id=list></ul>
<dialog id=dN>
<label>Title <input id=title type=text></label>
<label>Amount <input id=amount type=text></label>
<label>Start date <input id=start type=text></label>
<label>End date <input id=end type=text></label>
<p role="alert" id=err></p>
<button id=create onclick="create()">Create</button><button onclick="closeD()">Cancel</button>
</dialog>
<script>
const API='%s';
function openD(){document.getElementById('dN').showModal();}
function closeD(){document.getElementById('dN').close();}
async function load(){const r=await fetch(API);const items=await r.json();const ul=document.getElementById('list');ul.innerHTML='';
 for(const [i,it] of items.entries()){const li=document.createElement('li');const sp=document.createElement('span');
  sp.textContent=it.title+' '+it.amount;li.appendChild(sp);
  const b=document.createElement('button');b.textContent='Delete';
  b.onclick=async()=>{await fetch(API+'?del='+i,{method:'POST'});load();};
  li.appendChild(b);ul.appendChild(li);}}
async function create(){const body={title:document.getElementById('title').value,amount:document.getElementById('amount').value,
 start:document.getElementById('start').value,end:document.getElementById('end').value};
 await fetch(API,{method:'POST',body:JSON.stringify(body)});closeD();load();}
%s
load();
</script></body></html>"""

FIXED_JS = """
const F=['title','amount','start','end'].map(i=>document.getElementById(i));
const CB=document.getElementById('create'), ERR=document.getElementById('err');
function validate(){const [t,a,s,e]=F.map(x=>x.value);let msg='';
 if(!t.trim())msg='Title is required';
 else if(a.trim()===''||isNaN(parseFloat(a))||parseFloat(a)<0||parseFloat(a)>10000)msg='Amount must be a number between 0 and 10000';
 else if(!s)msg='Start date is required';
 else if(!e)msg='End date is required';
 else if(e<s)msg='End date must be after start date';
 CB.disabled=!!msg; ERR.textContent=msg;}
F.forEach(x=>x.addEventListener('input',validate)); validate();
"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="text/html"):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/api/auth/me"):
            if STATE["auth_off"]:
                return self._send(401, json.dumps({"ok": False}), "application/json")
            return self._send(200, json.dumps({"ok": True, "user": {"username": "zuko_qa_t1", "role": "member"}}), "application/json")
        if self.path.startswith("/api/buggy-items"):
            return self._send(200, json.dumps(STORES["buggy"]), "application/json")
        if self.path.startswith("/api/fixed-items"):
            return self._send(200, json.dumps(STORES["fixed"]), "application/json")
        if self.path.startswith("/lenses/formbuggy"):
            return self._send(200, FORM_PAGE % ("Formbuggy", "/api/buggy-items", ""))
        if self.path.startswith("/lenses/formfixed"):
            return self._send(200, FORM_PAGE % ("Formfixed", "/api/fixed-items", FIXED_JS))
        if self.path.startswith("/lenses/formboom"):
            return self._send(200, FORM_PAGE % ("Formboom", "/api/boom-items", ""))
        if self.path.startswith("/lenses/plain"):
            return self._send(200, "<!doctype html><html><body style='background:#111;color:#eee'><h1>Plain lens</h1><p>Nothing here.</p></body></html>")
        self._send(404, "not found")

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode()
        from urllib.parse import unquote
        for name, store in (("buggy", STORES["buggy"]), ("fixed", STORES["fixed"])):
            if self.path.startswith("/api/%s-items?del=" % name):
                try:
                    idx = int(unquote(self.path.split("=", 1)[1]))
                    if 0 <= idx < len(store):
                        store.pop(idx)
                except Exception:
                    pass
                return self._send(200, "{}", "application/json")
            if self.path.startswith("/api/%s-items" % name):
                try:
                    it = json.loads(body)
                except Exception:
                    it = {"title": body, "amount": "", "start": "", "end": ""}
                if name == "fixed":
                    try:
                        amt = float(it.get("amount", ""))
                    except Exception:
                        amt = -1
                    if not str(it.get("title", "")).strip() or amt < 0 or amt > 10000 \
                            or not it.get("start") or not it.get("end") or it["end"] < it["start"]:
                        return self._send(400, json.dumps({"error": "invalid"}), "application/json")
                store.append(it)
                return self._send(200, "{}", "application/json")
        if self.path.startswith("/api/boom-items"):
            return self._send(500, "boom")
        self._send(404, "not found")


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    tmp = tempfile.mkdtemp(prefix="walker-formfuzz-")
    audit = os.path.join(tmp, "audit")
    os.makedirs(os.path.join(audit, "reports"))
    os.makedirs(os.path.join(audit, "evidence"))
    inv = [{"slug": s, "url": base + "/lenses/" + s, "category": "test"}
           for s in ("formbuggy", "formfixed", "formboom", "plain")]
    json.dump(inv, open(os.path.join(audit, "inventory.json"), "w"))
    title = "Create form accepts blank title and negative amount with no error message"
    tickets = [
        {"id": "FIX-formbuggy-001", "lens": "formbuggy", "severity": "medium", "title": title,
         "repro_steps": ["Open the lens", "Click 'New item'", "Leave the title blank and set a negative amount", "Click 'Create'"],
         "expected": "The form rejects bad input with an inline error and creates nothing",
         "actual": "Blank and negative submissions are saved with no error",
         "evidence_path": "x", "suspected_area": "formbuggy/validation", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
        {"id": "FIX-formfixed-001", "lens": "formfixed", "severity": "medium", "title": title,
         "repro_steps": ["Open the lens", "Click 'New item'", "Leave the title blank and set a negative amount", "Click 'Create'"],
         "expected": "The form rejects bad input with an inline error and creates nothing",
         "actual": "Blank and negative submissions are saved with no error",
         "evidence_path": "x", "suspected_area": "formfixed/validation", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
        {"id": "FIX-formboom-001", "lens": "formboom", "severity": "medium", "title": title,
         "repro_steps": ["Open the lens", "Click 'New item'", "Submit blank"],
         "expected": "The form rejects bad input with an inline error and creates nothing",
         "actual": "Blank submissions are saved with no error",
         "evidence_path": "x", "suspected_area": "formboom/validation", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
        {"id": "FIX-plain-001", "lens": "plain", "severity": "medium", "title": title,
         "repro_steps": ["Open the lens"],
         "expected": "The form rejects bad input with an inline error and creates nothing",
         "actual": "Blank submissions are saved with no error",
         "evidence_path": "x", "suspected_area": "plain/validation", "status": "FIXED_PENDING_VERIFY", "tester": "t", "ts": "x"},
    ]
    with open(os.path.join(audit, "fix_tickets.jsonl"), "w") as f:
        for t in tickets:
            f.write(json.dumps(t) + "\n")
    cfg = json.load(open(os.path.join(WALKER, "config.json")))
    cfg["_walker_dir"] = WALKER  # load_config normally sets this
    # the fixture's /api/auth/me answers as zuko_qa_t1; pin the expected name so the
    # runner works against both config generations (pre- and post-WALK-02 accounts)
    cfg["accounts"]["t1"]["username"] = "zuko_qa_t1"
    cfg["base_url"] = base
    cfg["audit_dir"] = audit
    st = os.path.join(tmp, "t1.json")
    json.dump({"cookies": [], "origins": []}, open(st, "w"))
    cfg["accounts"]["t1"]["storage_state"] = st
    runs = os.path.join(tmp, "runs")
    os.makedirs(runs)
    cfg["runs_dir"] = runs
    cfg["queue_dir"] = os.path.join(tmp, "queue")
    cfg["thresholds"]["lens_budget_s"] = 600

    from concord_walker.util import Log, run_id
    from concord_walker.records import RunRecorder
    from concord_walker.tickets import TicketStore
    from concord_walker.reverify import Reverifier, classify
    try:
        from concord_walker.formfuzz import FormFuzz
    except Exception:
        FormFuzz = None  # pristine walker: the module does not exist yet
    from playwright.sync_api import sync_playwright

    results = {}
    results["classify"] = {t["id"]: classify(t) for t in tickets}
    log = Log(quiet=True)
    rec = RunRecorder(cfg, run_id() + "-formfuzz", dry=True)
    store = TicketStore(audit)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        try:
            rv = Reverifier(browser, cfg, rec, store, log, inv, allow_write=True)
            verdicts = {}
            for t in tickets:
                verdicts[t["id"]] = rv.run(t["id"])["verdict"]
            results["verdicts"] = verdicts
            # signed-out: drive the recipe directly (the smoke in rv.run guards its own account)
            STATE["auth_off"] = True
            try:
                results["signed_out"] = (FormFuzz(rv, store.get("FIX-formfixed-001")).run()["verdict"]
                                         if FormFuzz else "MODULE_ABSENT")
            finally:
                STATE["auth_off"] = False
        finally:
            browser.close()
    left = rec.flush_leftovers()
    results["leftovers_logged"] = [f["label"] for f in left]
    fxpath = os.path.join(rec.run_dir, "fixtures.jsonl")
    results["fixture_rows"] = [json.loads(l) for l in open(fxpath)] if os.path.exists(fxpath) else []
    results["buggy_store_after"] = list(STORES["buggy"])
    bad_left = [it for it in STORES["buggy"]
                if it.get("amount") in ("-1", "99999", "{bad") or it.get("title") == "{bad"]
    results["bad_value_records_remaining"] = bad_left
    pkg = os.path.join(WALKER, "concord_walker")
    banned = re.compile(r"\.(evaluate|evaluate_handle|locator|query_selector|query_selector_all|add_init_script|"
                        r"add_script_tag|expose_function|expose_binding|fill|get_by_\w+|wait_for_selector|"
                        r"wait_for_function|route)\(|Runtime\.evaluate|Runtime\.callFunctionOn")
    hits = [f + ":" + str(i + 1) for f in os.listdir(pkg) if f.endswith(".py")
            for i, line in enumerate(open(os.path.join(pkg, f))) if banned.search(line)]
    results["no_page_js_calls"] = not hits
    if hits:
        print("PAGE-JS CALLS FOUND:", hits)
    ok = (all(v == "validation" for v in results["classify"].values())
          and results["verdicts"].get("FIX-formbuggy-001") == "STILL_FAILING"
          and results["verdicts"].get("FIX-formfixed-001") == "FIXED"
          and results["verdicts"].get("FIX-formboom-001") == "NEEDS_HUMAN"
          and results["verdicts"].get("FIX-plain-001") == "NEEDS_HUMAN"
          and results["signed_out"] == "NEEDS_HUMAN"
          and not bad_left
          and any("blank-title" in l for l in results["leftovers_logged"])
          and results["no_page_js_calls"])
    print(json.dumps(results, indent=1, default=str))
    print("SELFTEST-FORMFUZZ", "PASS" if ok else "FAIL", "(tmp:", tmp, ")")
    srv.shutdown()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
