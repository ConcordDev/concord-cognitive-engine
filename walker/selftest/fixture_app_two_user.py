"""Two-user fake 'Concord' for the WALK-04c self-test. Stdlib only.

Identity rides a plain cookie (qa_user=qa-t1|qa-t2) so self-tests can act
as either account with a cookie jar or a Playwright storage state — no
login flow needed. Two independent defect switches:

  privacy="buggy"  — /api/items and the lens page return EVERY user's
                     items to any caller, signed-out included (the leak
                     shape WALK-04c exists to catch).
  privacy="fixed"  — items are scoped to their owner; signed-out reads
                     get a 401 and no body bytes.
  socket="buggy"   — room posts are accepted but never broadcast, so a
                     paired listener times out.
  socket="fixed"   — room posts broadcast a WebSocket text frame to every
                     connected room socket.

Room posts are shared BY DESIGN (both users are meant to see them); the
private surface is the item list. The WebSocket is a minimal RFC 6455
server: handshake + unmasked server->client text frames; client frames
are read and ignored except close.
"""
import base64, hashlib, json, struct, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

USERS = {"qa-t1": {"username": "qa-t1", "role": "member"},
         "qa-t2": {"username": "qa-t2", "role": "member"}}

PAGE = r"""<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{background:#111;color:#eee;font:16px sans-serif;margin:0;padding:8px}</style></head><body>
<h1>Pairprobe lens</h1>
<p id=who>__WHO__</p>
<h2>My items</h2>
<ul id=list>__ITEMS__</ul>
<label>Title <input id=title aria-label="Title"></label>
<button id=newb onclick="create()">Create item</button>
<h2>Room</h2>
<div id=room-log></div>
<label>Message <input id=msg aria-label="Message"></label>
<button id=postb onclick="post()">Post to room</button>
<script>
async function create(){const v=document.getElementById('title').value;
 await fetch('/api/items',{method:'POST',body:v}); location.reload();}
async function post(){const v=document.getElementById('msg').value;
 await fetch('/api/room',{method:'POST',body:v});}
try{const ws=new WebSocket('ws://'+location.host+'/ws');
 ws.onmessage=(e)=>{const p=document.createElement('p');p.textContent=e.data;
  document.getElementById('room-log').appendChild(p);};}catch(e){}
</script></body></html>"""


def _ws_accept(key):
    return base64.b64encode(hashlib.sha1(
        (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()


def _ws_frame(text):
    data = text.encode()
    if len(data) < 126:
        head = struct.pack("!BB", 0x81, len(data))
    else:
        head = struct.pack("!BBH", 0x81, 126, len(data))
    return head + data


def make_handler(privacy, socket_mode, store):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _user(self):
            for part in (self.headers.get("Cookie") or "").split(";"):
                part = part.strip()
                if part.startswith("qa_user="):
                    return USERS.get(part.split("=", 1)[1])
            return None

        def _send(self, code, body, ctype="text/html", extra=None):
            b = body.encode() if isinstance(body, str) else body
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def _visible_items(self, user):
            if privacy == "buggy":
                return [t for (_o, t) in store["items"]]
            if user is None:
                return None  # signals 401 in fixed mode
            return [t for (o, t) in store["items"] if o == user["username"]]

        def do_GET(self):
            if self.path.startswith("/login-as/"):
                name = self.path.split("/")[-1]
                if name in USERS:
                    return self._send(200, "{}", "application/json",
                                      {"Set-Cookie": "qa_user=%s; Path=/" % name})
                return self._send(404, "no such user")
            if self.path.startswith("/api/auth/me"):
                u = self._user()
                if not u:
                    return self._send(401, json.dumps({"ok": False}), "application/json")
                return self._send(200, json.dumps({"ok": True, "user": u}), "application/json")
            if self.path.startswith("/api/items"):
                vis = self._visible_items(self._user())
                if vis is None:
                    return self._send(401, json.dumps({"ok": False}), "application/json")
                return self._send(200, json.dumps(vis), "application/json")
            if self.path.startswith("/lenses/pairprobe"):
                u = self._user()
                vis = self._visible_items(u) or []
                items = "".join("<li>%s</li>" % t for t in vis)
                who = "signed in as %s" % u["username"] if u else "signed out"
                return self._send(200, PAGE.replace("__ITEMS__", items).replace("__WHO__", who))
            if self.path.startswith("/ws"):
                return self._ws()
            self._send(404, "not found")

        def _ws(self):
            key = self.headers.get("Sec-WebSocket-Key")
            if not key:
                return self._send(400, "no key")
            self.send_response(101, "Switching Protocols")
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", _ws_accept(key))
            self.end_headers()
            store["sockets"].append(self.connection)
            try:
                while True:
                    head = self.connection.recv(2)
                    if len(head) < 2:
                        break
                    opcode = head[0] & 0x0F
                    ln = head[1] & 0x7F
                    if ln == 126:
                        ln = struct.unpack("!H", self.connection.recv(2))[0]
                    elif ln == 127:
                        ln = struct.unpack("!Q", self.connection.recv(8))[0]
                    if head[1] & 0x80:
                        self.connection.recv(4)
                    if ln:
                        self.connection.recv(ln)
                    if opcode == 8:
                        break
            except Exception:
                pass
            finally:
                if self.connection in store["sockets"]:
                    store["sockets"].remove(self.connection)

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n).decode() if n else ""
            u = self._user()
            if self.path.startswith("/api/items"):
                if not u:
                    return self._send(401, json.dumps({"ok": False}), "application/json")
                store["items"].append((u["username"], body))
                return self._send(200, "{}", "application/json")
            if self.path.startswith("/api/room"):
                if not u:
                    return self._send(401, json.dumps({"ok": False}), "application/json")
                if socket_mode == "fixed":
                    frame = _ws_frame(body)
                    for s in list(store["sockets"]):
                        try:
                            s.sendall(frame)
                        except Exception:
                            pass
                return self._send(200, "{}", "application/json")
            self._send(404, "not found")

    return H


def serve(port=0, privacy="fixed", socket="fixed"):
    store = {"items": [], "sockets": []}
    srv = ThreadingHTTPServer(("127.0.0.1", port), make_handler(privacy, socket, store))
    srv.store = store
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
