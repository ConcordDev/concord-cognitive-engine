"""Local fake 'Concord' used only by the walker self-test. Contains deliberate bugs."""
import json, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ITEMS = []

DEMO = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#111;color:#eee;font:16px sans-serif;margin:0;padding:8px}
.low{color:#555;background:#444;padding:4px} .wide{width:900px;background:#222;height:20px}
dialog{background:#222;color:#eee} button{margin:4px;padding:8px}
.nofocus:focus{outline:none} [role=tab][aria-selected=true]{border-bottom:2px solid #fff}
.tabs{white-space:nowrap}</style></head><body>
<h1>Demo lens</h1>
<div class=tabs role=tablist>
 <button role=tab aria-selected=true id=t1 onclick="sel(1)">Overview</button>
 <button role=tab aria-selected=false id=t2 onclick="sel(2)">Broken</button>
 <button role=tab aria-selected=false id=t3 onclick="setTimeout(()=>sel(3),1600)">Slow</button>
</div>
<div id=panel>Overview content</div>
<p class=low>Low contrast helper text sample</p>
<div class=wide></div>
<button id=settings onclick="openD('dS',this)">Settings</button>
<button id=filters onclick="openD('dF',this)">Filters</button>
<button onclick="dl()">Export</button>
<button class=nofocus onclick=""><svg width=16 height=16><rect width=16 height=16 fill="#999"/></svg></button>
<div role=button onclick="">Fake action</div>
<button id=newb onclick="openD('dN',this)">New item</button>
<ul id=list></ul>
<dialog id=dS><p>Settings dialog</p><button onclick="closeD('dS')">Close</button></dialog>
<div id=dF role=dialog aria-label="Filters" hidden style="border:1px solid #888;padding:8px"><p>Filters panel</p><input aria-label="Filter text"></div>
<dialog id=dN><label>Title <input id=title></label><button onclick="create()">Create</button><button onclick="closeD('dN')">Cancel</button></dialog>
<script>
let opener=null;
function sel(n){for(let i=1;i<=3;i++)document.getElementById('t'+i).setAttribute('aria-selected',i==n);
 document.getElementById('panel').textContent = n==2 ? 'Something went wrong' : (n==3?'Slow content':'Overview content');}
function openD(id,b){opener=b;const d=document.getElementById(id); if(d.showModal){d.showModal(); d.addEventListener('close',()=>{opener&&opener.focus()},{once:true});} else {d.hidden=false;}}
function closeD(id){document.getElementById(id).close();}
function dl(){const a=document.createElement('a');a.href='/api/export';a.download='demo-export.json';document.body.appendChild(a);a.click();}
async function load(){const r=await fetch('/api/items');const items=await r.json();const ul=document.getElementById('list');ul.innerHTML='';
 for(const it of items){const li=document.createElement('li');li.innerHTML='<span></span> <button>Delete</button>';li.querySelector('span').textContent=it;
  li.querySelector('button').onclick=async()=>{await fetch('/api/items?del='+encodeURIComponent(it),{method:'POST'});load();};ul.appendChild(li);}}
async function create(){const v=document.getElementById('title').value;await fetch('/api/items',{method:'POST',body:v});closeD('dN');load();}
load();
</script></body></html>"""

CHAT = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><style>body{background:#fff;color:#111}</style></head>
<body><h1>Chat</h1><div id=tr></div><textarea aria-label="Message" id=m></textarea><button id=s disabled onclick="send()">Send</button>
<script>const m=document.getElementById('m'),s=document.getElementById('s');m.oninput=()=>{s.disabled=!m.value};
function send(){const p=document.createElement('p');p.textContent=m.value;document.getElementById('tr').appendChild(p);m.value='';s.disabled=true;}</script></body></html>"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="text/html", extra=None):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/health"):
            # sha gate (WALK-01): the selftest passes --expect-sha FIXTURE_SHA
            return self._send(200, json.dumps({"ok": True, "buildSha": FIXTURE_SHA}), "application/json")
        if self.path.startswith("/api/auth/me"):
            return self._send(200, json.dumps({"ok": True, "user": {"username": "concord-zukoqa", "role": "member"}}), "application/json")
        if self.path.startswith("/api/items"):
            return self._send(200, json.dumps(ITEMS), "application/json")
        if self.path.startswith("/api/export"):
            return self._send(200, json.dumps({"items": ["a", "b"]}), "application/json",
                              {"Content-Disposition": "attachment; filename=demo-export.json"})
        if self.path.startswith("/lenses/demo"):
            return self._send(200, DEMO)
        if self.path.startswith("/lenses/chat"):
            return self._send(200, CHAT)
        if self.path.startswith("/api/boom"):
            return self._send(500, "boom")
        self._send(404, "not found")

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode()
        if self.path.startswith("/api/items?del="):
            from urllib.parse import unquote
            v = unquote(self.path.split("=", 1)[1])
            if v in ITEMS:
                ITEMS.remove(v)
        elif self.path.startswith("/api/items"):
            ITEMS.append(body)
        self._send(200, "{}", "application/json")


FIXTURE_SHA = "f1c7a2e0" * 5  # 40-hex fixture build sha for the selftest sha gate


def serve(port=0):
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
