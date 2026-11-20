"""Fake lenses for the WALK-04e self-test (seat B10). Each lens ships a buggy
and a fixed variant: the buggy variant reproduces the ticket genus (toast-only
success, session-local persistence, wrong computed value, discarded upload);
the fixed variant behaves. The walker must call buggy STILL_FAILING and fixed
FIXED — never the reverse. Local only; not part of the shipped walker."""
import json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

SAVED = []    # server-side store for the fixed variants
UPLOADS = []  # server-side upload names for the fixed upload variant

STYLE = "<style>body{background:#141414;color:#eee;font:16px sans-serif;margin:0;padding:10px}button{margin:4px;padding:8px}input{padding:6px}</style>"

CLICK = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">%s</head><body>
<h1>Click lens</h1>
<div id=toast role=status></div>
<button id=save>Save record</button>
<ul id=list></ul>
<script>
const VARIANT = "%s", LABEL = "%s";
async function render(){ if(VARIANT!=="buggy"){ const r = await fetch('/api/items04e'); const items = await r.json();
  document.getElementById('list').innerHTML = items.map(i=>'<li>'+i+'</li>').join(''); } }
document.getElementById('save').onclick = async () => {
  if(VARIANT==="buggy"){ document.getElementById('toast').textContent = 'Saved!'; return; }
  if(VARIANT==="boom"){ await fetch('/api/boom04e', {method:'POST', body: LABEL}); document.getElementById('toast').textContent='Error'; return; }
  await fetch('/api/items04e', {method:'POST', body: LABEL});
  document.getElementById('toast').textContent = 'Saved!';
  render();
};
render();
</script></body></html>"""

PERSIST = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">%s</head><body>
<h1>Persist lens</h1>
<button id=create>Create record</button>
<ul id=list></ul>
<script>
const VARIANT = "%s", LABEL = "%s"; const local = [];
function draw(items){ document.getElementById('list').innerHTML = items.map(i=>'<li>'+i+'</li>').join(''); }
async function render(){ if(VARIANT==="buggy"){ draw(local); } else { const r = await fetch('/api/items04e'); draw(await r.json()); } }
document.getElementById('create').onclick = async () => {
  if(VARIANT==="buggy"){ local.push(LABEL); draw(local); return; }
  await fetch('/api/items04e', {method:'POST', body: LABEL}); render();
};
render();
</script></body></html>"""

COMPUTED = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">%s</head><body>
<h1>Computed lens</h1>
<p>Quantity: 2</p><p>Unit price: $3.50</p>
<p>Total: %s</p>
</body></html>"""

UPLOAD = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">%s</head><body>
<h1>Upload lens</h1>
<input type=file id=f aria-label="Upload file">
<div id=out></div>
<script>
const VARIANT = "%s";
async function render(){ if(VARIANT!=="buggy"){ const r = await fetch('/api/uploads04e'); const names = await r.json();
  document.getElementById('out').innerHTML = names.map(n=>'<p><canvas width=24 height=24 style="background:linear-gradient(45deg,#c33,#33c)"></canvas> '+n+'</p>').join(''); } }
document.getElementById('f').onchange = async (e) => {
  const file = e.target.files[0]; if(!file) return;
  if(VARIANT==="buggy"){ return; }
  await fetch('/api/uploads04e?name=' + encodeURIComponent(file.name), {method:'POST', body: await file.arrayBuffer()});
  render();
};
render();
</script></body></html>"""


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
        u = urlparse(self.path)
        q = parse_qs(u.query)
        variant = (q.get("v") or ["fixed"])[0]
        label = (q.get("label") or ["qa-walker-04e-item"])[0]
        if u.path.startswith("/api/auth/me"):
            return self._send(200, json.dumps({"ok": True, "user": {"username": "zuko_qa_t1", "role": "member"}}), "application/json")
        if u.path.startswith("/api/items04e"):
            return self._send(200, json.dumps(SAVED), "application/json")
        if u.path.startswith("/api/uploads04e"):
            return self._send(200, json.dumps(UPLOADS), "application/json")
        if u.path.startswith("/lenses/click"):
            return self._send(200, CLICK % (STYLE, variant, label))
        if u.path.startswith("/lenses/persist"):
            return self._send(200, PERSIST % (STYLE, variant, label))
        if u.path.startswith("/lenses/computed"):
            return self._send(200, COMPUTED % (STYLE, "$7.50" if variant == "buggy" else "$7.00"))
        if u.path.startswith("/lenses/upload"):
            return self._send(200, UPLOAD % (STYLE, variant))
        self._send(404, "not found")

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode("utf-8", "replace")
        if u.path.startswith("/api/items04e"):
            SAVED.append(body)
            return self._send(200, "{}", "application/json")
        if u.path.startswith("/api/uploads04e"):
            UPLOADS.append(unquote(q.get("name", ["file"])[0]))
            return self._send(200, "{}", "application/json")
        if u.path.startswith("/api/boom04e"):
            return self._send(500, "boom")
        self._send(404, "not found")


def serve(port=0):
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
