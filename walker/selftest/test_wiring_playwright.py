#!/usr/bin/env python3
"""Real-Chromium check of wiring capture's NetLedger hook (shapes=True): a local fixture app whose button POSTs a JSON body
carrying a password and gets a JSON body carrying a token. Asserts the ledger records the SHAPES (typed, secret keys
'redacted'), attributes the request to the button's control window, and that NO secret value appears anywhere in the serialized
wiring. Local 127.0.0.1 only - never prod, no accounts. SKIPs (exit 0) where playwright is absent.
Run on the box:  <venv>/bin/python selftest/test_wiring_playwright.py <walker dir>"""
import http.server, json, os, sys, threading, time

WALKER = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, WALKER)
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("SKIP: playwright is not installed here - run this selftest on the walker box")
    sys.exit(0)
from concord_walker import netledger as N, wiring as W

SECRET_PW, SECRET_TOK = "pw-SECRETVALUE-123", "tok-SECRETVALUE-456"
PAGE = """<!doctype html><title>t</title><button id=b onclick="fetch('/api/notes',{method:'POST',headers:{'content-type':'application/json'},
body:JSON.stringify({title:'T',password:'%s',tags:['a']})}).then(r=>r.json()).then(j=>document.title=String(j.id))">Add note</button>""" % SECRET_PW
FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:300] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.end_headers()
        self.wfile.write(PAGE.encode())

    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length", 0)))
        self.send_response(201)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"id": 7, "token": SECRET_TOK, "items": [{"a": 1}]}).encode())


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % srv.server_address[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    led = N.NetLedger(base, shapes=True)
    led.attach(page)
    led.open_window("load", "page", "-", sticky=True)
    page.goto(base + "/")
    led.close_window()
    led.open_window("sweep", "button", "Add note")
    page.click("#b")
    page.wait_for_timeout(1000)
    led.close_window()
    controls, eps, acts, summ = led.build()
    b.close()
srv.shutdown()
lw = W.build_lens("fixture", controls, {}, "run-pw", "272e62f41", {})
ser = json.dumps(lw)
c = next(x for x in lw["controls"] if x["label"]["text"] == "Add note")
q = next((r for r in c["requests"] if r.get("method") == "POST" and r.get("path") == "/api/notes"), {})
ld = next((x for x in lw["controls"] if x.get("control_id") == "load:page:-" or x.get("label", {}).get("text") == "-"), {})
check("the load GET / is attributed to load:page:-", any(r.get("method") == "GET" and r.get("path") == "/" for r in ld.get("requests", [])) and not any(r.get("method") == "GET" and r.get("path") == "/" for r in c["requests"]), (ld.get("requests"), c["requests"]))
check("the POST is attributed to the Add note control", q.get("method") == "POST" and q.get("path") == "/api/notes", c["requests"])
check("request shape is typed with the secret key redacted", q.get("request_shape") == {"password": "redacted", "tags": ["string"], "title": "string"}, q.get("request_shape"))
check("response shape is typed with the secret key redacted", q.get("response_shape") == {"id": "number", "items": [{"a": "number"}], "token": "redacted"}, q.get("response_shape"))
check("NO secret value appears anywhere in the serialized wiring", SECRET_PW not in ser and SECRET_TOK not in ser)
check("with no registry the joins read unresolved:no_registry", q.get("route") == "unresolved:no_registry")
print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
