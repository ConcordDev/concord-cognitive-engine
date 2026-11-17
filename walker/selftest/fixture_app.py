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

# Upgrades fixture (Dutch, Nov 16): per-control errors, write-then-read-back,
# two-account ownership, speed/freeze, failure-only screenshots.
NOTE_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"
NOTES = {NOTE_ID: {"owner": "t1", "pinned": False, "title": "t1 private note"}}
UPGRADES = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#111;color:#eee;font:16px sans-serif} button{margin:4px;padding:8px}</style></head><body>
<h1>Upgrades lens</h1><div id=out>ready</div><div id=pin>Pinned: no</div><div id=star>Starred: no</div><div id=badge></div>
<button onclick="openNote()">Open note</button>
<button onclick="pinNote()">Pin note</button>
<button onclick="starNote()">Star note</button>
<button onclick="crash()">Crash widget</button>
<button onclick="asyncFail()">Async fail</button>
<button onclick="badge()">Badge icon</button>
<button onclick="fetch('/api/slow').then(()=>{document.getElementById('out').textContent='report ok'})">Slow stats</button>
<button onclick="heavy()">Heavy chart</button>
<button onclick="">Idle button</button>
<button onclick="openMenu()">Open menu</button>
<button onclick="bookmark()">Bookmark</button>
<div role=status id=toast></div>
<button onclick="prefetchLink()">Prefetch link</button>
<div id=menu></div>
<script>
const ID='__NOTE__';
function openNote(){fetch('/api/notes/'+ID);fetch('/api/secure-notes/'+ID);fetch('/api/public-notes/'+ID);fetch('/api/memory/'+ID);fetch('/api/drafts/'+ID);fetch('/api/chat/memory/'+ID);fetch('/api/ct/merit/'+ID);}
async function bookmark(){const r=await fetch('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 if(r.ok){const t=document.getElementById('toast');t.textContent='Bookmarked successfully';}}
function openMenu(){document.getElementById('menu').textContent='Avatars; Power Mode; Settings';
 fetch('/api/metrics/vitals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'INP',value:12})});}
function prefetchLink(){const c=new AbortController();fetch('/api/slow?prefetch=1',{signal:c.signal}).catch(()=>{});setTimeout(()=>c.abort(),50);
 document.getElementById('out').textContent='prefetched';}
async function pinNote(){const r=await fetch('/api/notes/'+ID,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({pinned:true})});
 if(r.ok) document.getElementById('pin').textContent='Pinned: yes';}
async function starNote(){const r=await fetch('/api/notes/'+ID+'/star',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 if(r.ok) document.getElementById('star').textContent='Starred: yes';}
function crash(){console.error('The above error occurred in the <Widget> component'); throw new Error('widget exploded');}
function asyncFail(){Promise.reject(new Error('async boom'));}
function badge(){const i=document.createElement('img');i.src='/static/missing-badge.png';i.alt='badge';document.getElementById('badge').appendChild(i);}
function heavy(){const t=Date.now();while(Date.now()-t<1600){}}
fetch('/api/notes/'+ID).then(r=>r.json()).then(j=>{if(j.pinned)document.getElementById('pin').textContent='Pinned: yes';});
</script></body></html>""".replace("__NOTE__", NOTE_ID)


def _who(headers):
    """t1 / t2 from the fixture session cookie; None = signed out (anonymous)."""
    c = headers.get("Cookie") or ""
    return "t2" if "fx_user=t2" in c else ("t1" if "fx_user=t1" in c else None)
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
            user = "zukoqb" if _who(self.headers) == "t2" else "concord-zukoqa"
            return self._send(200, json.dumps({"ok": True, "user": {"username": user, "role": "member"}}), "application/json")
        if self.path.startswith("/lenses/upgrades"):
            return self._send(200, UPGRADES)
        if self.path.startswith("/api/slow"):
            time.sleep(1.3)
            return self._send(200, json.dumps({"ok": True}), "application/json")
        if self.path.startswith("/api/public-notes/"):
            # readable by anyone, signed out too: the two-account replay must call this PUBLIC, not ownership
            n = NOTES.get(self.path.split("/")[3])
            return self._send(200 if n else 404, json.dumps({"title": "public"} if n else {"error": "not found"}), "application/json")
        if self.path.startswith("/api/ct/merit/"):
            # intended public to members (config/intended_public.json): identical non-empty for
            # t1 and t2, signed-out 401 -> PUBLIC_INTENDED, never OWNERSHIP_FAIL
            if _who(self.headers) is None:
                return self._send(401, json.dumps({"error": "sign in"}), "application/json")
            return self._send(200, json.dumps({"ok": True, "score": 712, "tier": "gold", "events": 9, "updated": "2026-11-15"}), "application/json")
        if self.path.startswith("/api/chat/memory/"):
            # pre-#2371 prod shape: any signed-in caller gets the same zeroed stats for an
            # unseen session. Identical for t1 and t2 but contentless -> EMPTY, not a leak.
            if _who(self.headers) is None:
                return self._send(401, json.dumps({"error": "sign in"}), "application/json")
            return self._send(200, json.dumps({"ok": True, "activeMessages": 0, "totalMessagesProcessed": 0,
                                               "compressionCycles": 0, "memoryDtuCount": 0, "megaCount": 0,
                                               "topics": [], "windowUtilization": "0/50"}), "application/json")
        if self.path.startswith("/api/memory/") or self.path.startswith("/api/drafts/"):
            # ignore the path id and answer with the CALLER's own data: not an ownership leak
            w = _who(self.headers)
            if w is None:
                return self._send(401, json.dumps({"error": "sign in"}), "application/json")
            if self.path.startswith("/api/memory/"):
                return self._send(200, json.dumps({"ok": True, "owner": w, "items": [w + " memory"]}), "application/json")
            return self._send(200, json.dumps({"ok": True, "items": [w + " draft"] if w == "t1" else []}), "application/json")
        if self.path.startswith("/api/notes/"):
            if _who(self.headers) is None:
                return self._send(401, json.dumps({"error": "sign in"}), "application/json")
            n = NOTES.get(self.path.split("/")[3])
            # deliberately NO ownership check (the bug the two-account replay must catch)
            return self._send(200 if n else 404, json.dumps(n or {"error": "not found"}), "application/json")
        if self.path.startswith("/api/secure-notes/"):
            n = NOTES.get(self.path.split("/")[3])
            ok = n and n["owner"] == _who(self.headers)
            return self._send(200 if ok else 404, json.dumps(n if ok else {"error": "not found"}), "application/json")
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

    def do_PATCH(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode()
        POSTS.append("PATCH " + self.path)
        if self.path.startswith("/api/notes/"):
            note = NOTES.get(self.path.split("/")[3])
            if note:
                try:
                    note["pinned"] = bool(json.loads(body or "{}").get("pinned"))
                except Exception:
                    pass
                return self._send(200, json.dumps({"ok": True}), "application/json")
        self._send(404, "{}", "application/json")

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode()
        POSTS.append(self.path)
        if self.path.startswith("/api/metrics/"):
            return self._send(204, "")
        if self.path.startswith("/api/bookmarks"):
            return self._send(200, json.dumps({"ok": True}), "application/json")
        if self.path.startswith("/api/notes/") and self.path.endswith("/star"):
            # fake success: 200 but nothing is stored
            return self._send(200, json.dumps({"ok": True}), "application/json")
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
