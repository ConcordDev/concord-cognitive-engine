#!/usr/bin/env python3
"""WALK-04c offline self-test (GB-1544).

Legs that need no browser: the verdict logic, the byte oracle, the money
deny-list, the two-user fixture over real HTTP (the API leg of the
foreign-row probe at the transport level context.request uses), a real
WebSocket frame from the fixture's room, and FrameCapture over a stub
CDP session. On the pristine walker this file fails at import —
concord_walker.privacy_checks does not exist there.

The browser-driven legs (isolated contexts + AX texts through
Playwright) run where the walker's venv + Chrome exist (the box run
host / private CI); they are NOT run here and are not implied.
"""
import base64, http.client, json, os, re, socket, struct, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)
sys.path.insert(0, HERE)

from concord_walker import privacy_checks as pc
from fixture_app_two_user import serve

LABEL = "qa-walker-pairprobe-20261114-0001"
results = {}


def check(name, cond):
    results[name] = bool(cond)
    print(("PASS " if cond else "FAIL ") + name, flush=True)


# ---------------------------------------------------------------- logic legs
v, leaks = pc.foreign_probe_verdict({"t2": ["hello", LABEL]}, {"t2": ["[]"]}, LABEL)
check("logic: UI leak -> STILL", v == pc.STILL and leaks == ["t2:ui"])
v, leaks = pc.foreign_probe_verdict({"t2": ["hello"]}, {"signed-out": ['["%s"]' % LABEL]}, LABEL)
check("logic: API-body leak -> STILL", v == pc.STILL and leaks == ["signed-out:api"])
v, leaks = pc.foreign_probe_verdict({"t2": ["hello"], "signed-out": []},
                                    {"t2": ["[]"], "signed-out": [""]}, LABEL)
check("logic: clean -> FIXED", v == pc.FIXED and leaks == [])
check("logic: socket both signals -> FIXED", pc.socket_pair_verdict(True, True) == pc.FIXED)
check("logic: socket frame only -> HUMAN", pc.socket_pair_verdict(True, False) == pc.HUMAN)
check("logic: socket AX only -> HUMAN", pc.socket_pair_verdict(False, True) == pc.HUMAN)
check("logic: socket neither -> STILL", pc.socket_pair_verdict(False, False) == pc.STILL)
check("logic: byte oracle on bytes", pc.body_leaks(b'{"x":"' + LABEL.encode() + b'"}', LABEL)
      and not pc.body_leaks(b'{"x":"other"}', LABEL))
probe, excluded = pc.filter_probe_routes(["/api/items", "/api/wallet/balance", "/api/dm/list"])
check("logic: money route excluded", probe == ["/api/items", "/api/dm/list"]
      and excluded == ["/api/wallet/balance"])


# ------------------------------------------------------- FrameCapture (stub)
class StubSession:
    def __init__(self):
        self.handlers = {}
        self.sent = []

    def send(self, method, params=None):
        self.sent.append(method)
        return {}

    def on(self, event, handler):
        self.handlers[event] = handler


stub = StubSession()
cap = pc.FrameCapture(stub)
check("frames: Network.enable sent", stub.sent == ["Network.enable"])
stub.handlers["Network.webSocketFrameReceived"](
    {"response": {"opcode": 1, "payloadData": "room:" + LABEL}})
got = cap.wait_for(needle=LABEL, timeout=1.0)
check("frames: needle frame captured", got is not None and LABEL in got["payload"])
check("frames: timeout returns None", cap.wait_for(needle="absent", timeout=0.3) is None)


# ---------------------------------------------------------------- HTTP legs
def call(port, method, path, cookie=None, body=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {}
    if cookie:
        headers["Cookie"] = "qa_user=" + cookie
    c.request(method, path, body=body, headers=headers)
    r = c.getresponse()
    data = r.read().decode("utf-8", "replace")
    c.close()
    return r.status, data


def http_legs(privacy):
    srv = serve(privacy=privacy, socket="fixed")
    port = srv.server_address[1]
    try:
        st, _ = call(port, "POST", "/api/items", cookie="qa-t1", body=LABEL)
        assert st == 200
        _s, t1_items = call(port, "GET", "/api/items", cookie="qa-t1")
        _s, t2_items = call(port, "GET", "/api/items", cookie="qa-t2")
        anon_status, anon_items = call(port, "GET", "/api/items")
        return t1_items, t2_items, anon_status, anon_items
    finally:
        srv.shutdown()


t1, t2, a_st, anon = http_legs("buggy")
check("http buggy: owner sees own label", LABEL in t1)
check("http buggy: t2 API body leaks (defect reproduced)", LABEL in t2)
check("http buggy: signed-out API body leaks", LABEL in anon)
v, leaks = pc.foreign_probe_verdict({}, {"t2": [t2], "signed-out": [anon]}, LABEL)
check("http buggy: probe verdict STILL", v == pc.STILL)

t1, t2, a_st, anon = http_legs("fixed")
check("http fixed: owner sees own label", LABEL in t1)
check("http fixed: t2 API body clean", LABEL not in t2)
check("http fixed: signed-out 401, no bytes", a_st == 401 and LABEL not in anon)
v, leaks = pc.foreign_probe_verdict({}, {"t2": [t2], "signed-out": [anon]}, LABEL)
check("http fixed: probe verdict FIXED", v == pc.FIXED)


# ------------------------------------------------------------------ WS legs
def ws_connect(port):
    s = socket.create_connection(("127.0.0.1", port), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall(("GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % key).encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(4096)
        if not chunk:
            raise RuntimeError("handshake closed")
        buf += chunk
    assert b"101" in buf.split(b"\r\n", 1)[0], buf[:80]
    return s, buf.split(b"\r\n\r\n", 1)[1]


def ws_read_frame(s, buf, timeout=3.0):
    s.settimeout(timeout)
    while len(buf) < 2:
        buf += s.recv(4096)
    ln = buf[1] & 0x7F
    off = 2
    if ln == 126:
        while len(buf) < 4:
            buf += s.recv(4096)
        ln = struct.unpack("!H", buf[2:4])[0]
        off = 4
    while len(buf) < off + ln:
        buf += s.recv(4096)
    return buf[off:off + ln].decode("utf-8", "replace")


def ws_legs(socket_mode):
    srv = serve(privacy="fixed", socket=socket_mode)
    port = srv.server_address[1]
    try:
        s, rest = ws_connect(port)
        call(port, "POST", "/api/room", cookie="qa-t1", body="room-marker-" + LABEL)
        try:
            return ws_read_frame(s, rest, timeout=2.0)
        except Exception:
            return None
        finally:
            s.close()
    finally:
        srv.shutdown()


frame = ws_legs("fixed")
check("ws fixed: frame carries the marker", frame is not None and LABEL in frame)
frame = ws_legs("buggy")
check("ws buggy: no frame (timeout path)", frame is None)


# ------------------------------------------------------------- no page JS
banned = re.compile(r"\.(evaluate|evaluate_handle|locator|query_selector|query_selector_all|"
                    r"add_init_script|add_script_tag|expose_function|expose_binding|fill|"
                    r"get_by_\w+|wait_for_selector|wait_for_function|route)\(|Runtime\.evaluate|"
                    r"Runtime\.callFunctionOn")
src = open(os.path.join(WALKER, "concord_walker", "privacy_checks.py")).read()
check("privacy_checks.py: no page-JS calls", not banned.search(src))

ok = all(results.values())
print(json.dumps(results, indent=1))
print("SELFTEST-04C", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
