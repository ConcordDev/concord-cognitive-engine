"""Fake Concord lenses for the WALK-04b write-lane self-test (B8).

Each lens isolates one write-lane behaviour:
  good    — well-behaved CRUD: labelled create, confirm-gated delete.
  publate — the create form reveals public/feed visibility wording only
            AFTER typing starts (the G2 hole: a walker that scans the
            form only at open time creates a public fixture).
  pubopen — visibility wording present at open (control: must abort).
  ambig   — every row carries two delete controls, so no delete control
            is tied unambiguously to the fixture label (partial write).
  vanish  — the create dialog closes itself mid-typing (the form is
            gone before submit: crash-mid-create semantics).

Server-side truth lives in ITEMS / POSTS so tests can assert that an
aborted run created NOTHING. ME_USER is mutable so a test can serve a
wrong-account /api/auth/me.
"""
import json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

ITEMS = []
POSTS = []
ME_USER = {"username": "zuko_qa_t1", "role": "member"}

PAGE = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#111;color:#eee;font:16px sans-serif;margin:0;padding:8px}
dialog{background:#222;color:#eee} button{margin:4px;padding:8px}</style></head><body>
<h1>%TITLE%</h1>
<button id=newb onclick="openD('dN',this)">New item</button>
<ul id=list></ul>
<dialog id=dN><label>Title <input id=title></label>
<p id=hint %HINTSTYLE%>This item will be posted to the public feed, visible to everyone.</p>
<button onclick="create()">Create</button><button onclick="closeD('dN')">Cancel</button></dialog>
<dialog id=dC><p>Are you sure? This permanently deletes the item.</p>
<button onclick="confirmDel()">Delete</button><button onclick="closeD('dC')">Cancel</button></dialog>
<script>
let pendingDel=null;
function openD(id,b){const d=document.getElementById(id); d.showModal && d.showModal();}
function closeD(id){document.getElementById(id).close();}
%EXTRA%
async function load(){const r=await fetch('/api/items04b');const items=await r.json();const ul=document.getElementById('list');ul.innerHTML='';
 for(const it of items){const li=document.createElement('li');const s=document.createElement('span');s.textContent=it;li.appendChild(s);
  %ROWBUTTONS%
  ul.appendChild(li);}}
async function create(){const v=document.getElementById('title').value;await fetch('/api/items04b',{method:'POST',body:v});closeD('dN');load();}
async function del(it){await fetch('/api/items04b?del='+encodeURIComponent(it),{method:'POST'});load();}
function askDel(it){pendingDel=it;openD('dC',null);}
async function confirmDel(){closeD('dC'); if(pendingDel){await del(pendingDel); pendingDel=null;}}
load();
</script></body></html>"""

ROW_GOOD = """const b=document.createElement('button');b.textContent='Delete';b.onclick=()=>askDel(it);li.appendChild(b);"""
ROW_AMBIG = """const b1=document.createElement('button');b1.textContent='Delete';b1.onclick=()=>askDel(it);li.appendChild(b1);
  const b2=document.createElement('button');b2.textContent='Delete forever';b2.onclick=()=>askDel(it);li.appendChild(b2);"""
EXTRA_PUBLATE = """document.getElementById('title').addEventListener('input',()=>{document.getElementById('hint').style.display='block';});"""
EXTRA_VANISH = """let vanished=false;document.getElementById('title').addEventListener('input',()=>{if(!vanished){vanished=true;setTimeout(()=>closeD('dN'),500);}});"""


def page(kind):
    hint = "" if kind in ("pubopen",) else "style=\"display:none\""
    extra = {"publate": EXTRA_PUBLATE, "vanish": EXTRA_VANISH}.get(kind, "")
    rows = ROW_AMBIG if kind == "ambig" else ROW_GOOD
    return (PAGE.replace("%TITLE%", "Lens " + kind).replace("%HINTSTYLE%", hint)
            .replace("%EXTRA%", extra).replace("%ROWBUTTONS%", rows))


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
            return self._send(200, json.dumps({"ok": True, "user": ME_USER}), "application/json")
        if self.path.startswith("/api/items04b"):
            return self._send(200, json.dumps(ITEMS), "application/json")
        for kind in ("good", "publate", "pubopen", "ambig", "vanish", "skipme", "ops"):
            if self.path.startswith("/lenses/" + kind):
                return self._send(200, page("good" if kind in ("skipme", "ops") else kind))
        self._send(404, "not found")

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode()
        POSTS.append((self.path, body))
        if self.path.startswith("/api/items04b?del="):
            v = unquote(self.path.split("=", 1)[1])
            if v in ITEMS:
                ITEMS.remove(v)
        elif self.path.startswith("/api/items04b"):
            ITEMS.append(body)
        self._send(200, "{}", "application/json")


def serve(port=0):
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
