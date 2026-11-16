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


# MST-W0-02/03 premap fixture: a lens-run button, a dead button, a destructive
# button, a 500 button, a tab, a background poll and a lens GET on load.
PREMAP = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#111;color:#eee;font:16px sans-serif} button{margin:4px;padding:8px}</style></head><body>
<h1>Premap lens</h1>
<div role=tablist><button role=tab aria-selected=true id=ta onclick="tab('a')">Main</button>
<button role=tab aria-selected=false id=tb onclick="tab('b')">Details</button></div>
<div id=out>ready</div>
<button onclick="runCalc()">Run calc</button>
<button onclick="">Dead button</button>
<button onclick="fetch('/api/items?del=all',{method:'POST'})">Delete all</button>
<button onclick="fetch('/api/boom').then(()=>{document.getElementById('out').textContent='boom'})">Load stats</button>
<button onclick="document.getElementById('out').textContent='shown '+Date.now()">Show tips</button>
<button disabled>Locked</button>
<script>
function tab(x){document.getElementById('ta').setAttribute('aria-selected',x=='a');document.getElementById('tb').setAttribute('aria-selected',x=='b');
 if(x=='b') fetch('/api/lens/fixture/123e4567-e89b-12d3-a456-426614174000');}
async function runCalc(){const r=await fetch('/api/lens/run',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({domain:'fixture',action:'calc',input:{secret_value:'do-not-store-me',n:2}})});const j=await r.json();
 document.getElementById('out').textContent='result '+j.result.value;}
fetch('/api/lens/fixture?limit=5&cursor=abc');
setInterval(()=>fetch('/api/poll'),700);
</script></body></html>"""

POSTS = []
# resilience knobs (set by selftests in-process): drop the next N auth/me
# connections without a response, answer auth/me with a fixed status, or send
# 502 for the next N loads of /lenses/flaky.
AUTH = {"drop_next": 0, "status": None}
GATEWAY = {"flaky_502": 0}


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
        if self.path.startswith("/api/auth/me") and AUTH["drop_next"] > 0:
            AUTH["drop_next"] -= 1
            self.close_connection = True
            try:
                self.connection.shutdown(2)
            except Exception:
                pass
            return
        if self.path.startswith("/api/auth/me") and AUTH["status"]:
            return self._send(AUTH["status"], json.dumps({"ok": False}), "application/json")
        if self.path.startswith("/lenses/flaky"):
            if GATEWAY["flaky_502"] > 0:
                GATEWAY["flaky_502"] -= 1
                return self._send(502, "Bad Gateway")
            return self._send(200, "<!doctype html><html><body><h1>Flaky lens</h1><button>Help</button></body></html>")
        if self.path.startswith("/api/auth/me"):
            return self._send(200, json.dumps({"ok": True, "user": {"username": "concord-zukoqa", "role": "member"}}), "application/json")
        if self.path.startswith("/api/items"):
            return self._send(200, json.dumps(ITEMS), "application/json")
        if self.path.startswith("/api/export"):
            return self._send(200, json.dumps({"items": ["a", "b"]}), "application/json",
                              {"Content-Disposition": "attachment; filename=demo-export.json"})
        if self.path.startswith("/lenses/premap"):
            return self._send(200, PREMAP)
        if self.path.startswith("/api/poll"):
            return self._send(200, json.dumps({"ok": True, "n": 1}), "application/json")
        if self.path.startswith("/api/lens/fixture"):
            return self._send(200, json.dumps({"ok": True, "items": [{"title": "private row value"}]}), "application/json")
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
        POSTS.append(self.path)
        if self.path.startswith("/api/lens/run"):
            return self._send(200, json.dumps({"ok": True, "result": {"value": 4, "signed": False, "signingReason": "missing_declaration"}}),
                              "application/json")
        if self.path.startswith("/api/items?del=all"):
            return self._send(500, "{}", "application/json")
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
