#!/usr/bin/env python3
"""CB-1099 slice W: the core-verb domain witness.

Walk 3 judged persistence only in the lens-artifact store; lenses that keep
their verb objects in a domain store behind their own read actions filed as
fake successes (15 of the 20, CB-1099 Group A). The phase now also re-issues
the lens's own recorded read calls (the domain witness) and combines all
three witnesses: any True persists; an answered set with no True fails;
nothing answered stays UNSPECIFIED.

Pins: (pure) domain_read_calls selects same-domain non-verb 2xx reads and
caps; combine_witnesses' truth table. (phase, c28 harness idiom) a Group A
lens — verb writes to the domain store, artifact GET 404s, artifact list
empty, the lens's own docList read carries the object — verdicts PASS on
the built phase and FAIL on the pre-W witness; a true fake (no witness
sees the object) still FAILs; the observer's domain read scopes visibility.

No browser, no network."""
import json, os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)

from concord_walker import auth, checks
from concord_walker import core_verbs as cv

FAILS = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)

# ------------------------------------------------------------ pure helpers
CALLS = [
    {"method": "POST", "path": "/api/lens/run", "url": "https://x/api/lens/run",
     "post": json.dumps({"domain": "collab", "action": "docCreate", "args": {}}), "status": 200},
    {"method": "POST", "path": "/api/lens/run", "url": "https://x/api/lens/run",
     "post": json.dumps({"domain": "collab", "action": "docList", "args": {}}), "status": 200},
    {"method": "POST", "path": "/api/lens/run", "url": "https://x/api/lens/run",
     "post": json.dumps({"domain": "thread", "action": "draft-list", "args": {}}), "status": 200},
    {"method": "POST", "path": "/api/lens/run", "url": "https://x/api/lens/run",
     "post": json.dumps({"domain": "collab", "action": "docGet", "args": {}}), "status": 500},
    {"method": "GET", "path": "/api/lens/collab", "url": "https://x/api/lens/collab",
     "post": None, "status": 200},
    {"method": "GET", "path": "/api/lens/thread/:id", "url": "https://x/api/lens/thread/9",
     "post": None, "status": 200},
]
sel = cv.domain_read_calls(CALLS, "collab", "docCreate")
check("selector keeps the same-domain read + the lens GET",
      len(sel) == 2 and sel[0]["method"] == "POST" and sel[1]["method"] == "GET")
check("selector excludes the verb itself + other domains + non-2xx",
      all((c["post"] or "").find("docCreate") < 0 for c in sel)
      and all("thread" not in (c["url"] or "") for c in sel))
check("selector caps", len(cv.domain_read_calls(CALLS * 4, "collab", "docCreate")) == 6)
check("combine: any True wins", cv.combine_witnesses(False, False, True) is True)
check("combine: answered, none saw -> False", cv.combine_witnesses(False, None, False) is False)
check("combine: nothing answered -> None", cv.combine_witnesses(None, None, None) is None)
check("combine: single False -> False", cv.combine_witnesses(None, False, None) is False)

# ------------------------------------------------------------ phase drives
class Resp:
    def __init__(self, status, payload=None, text=None):
        self.status = status
        self._p = payload
        self._t = text if text is not None else (json.dumps(payload) if payload is not None else "")
    def json(self):
        if self._p is None:
            raise ValueError("no json")
        return self._p
    def text(self):
        return self._t

STATE = {"writer_list": "", "observer_list": "", "artifact_list": ""}

class Req:
    def __init__(self, who):
        self.who = who
    def post(self, url, data=None, headers=None, timeout=None):
        body = json.loads(data) if isinstance(data, str) else (data or {})
        if body.get("action") == "docCreate":
            return Resp(200, {"ok": True, "result": {"id": "doc-991", "title": "t"}})
        if body.get("action") == "docList":
            txt = STATE["writer_list"] if self.who == "writer" else STATE["observer_list"]
            return Resp(200, None, txt)
        return Resp(200, {"ok": True, "result": {}})
    def get(self, url, timeout=None):
        if url.endswith("/api/lens/collab/doc-991"):
            return Resp(404, None, "not found")
        if url.endswith("/api/lens/collab"):
            return Resp(200, None, STATE["artifact_list"] if self.who == "writer" else "[]")
        return Resp(404, None, "")

class Ctx:
    def __init__(self, who):
        self.request = Req(who)
    def close(self):
        pass

class Net:
    def leg_calls(self):
        return [c for c in CALLS if (c["post"] or "").find("docList") >= 0]

def make_walk():
    w = object.__new__(checks.LensWalk)
    w.cfg = {"base_url": "https://x", "fixture_prefix": "wk",
             "viewport_desktop": {"width": 1, "height": 1},
             "accounts": {"t1": {"username": "a"}, "t2": {"username": "b"}}}
    w.slug = "collab"
    w.b = None
    w.th = {}
    w.acct = "t2"
    w.rec = types.SimpleNamespace(rid="run-000abc")
    w.result = {}
    w.net = Net()
    w.log = lambda *a, **k: None
    w.findings_made = []
    w.finding = lambda *a, **k: w.findings_made.append((a, k))
    w.open = lambda account=None: (Ctx("writer"), None, None)
    w._close = lambda ctx: None
    return w

checks.new_context = lambda b, cfg, acct, vp: Ctx("observer")
checks.assert_account = lambda *a, **k: None
auth.has_session = lambda cfg, acct: True

# Scenario 1 — Group A: the domain witness sees it, the artifact store does not.
STATE.update(writer_list='[{"id": "doc-991"}]', observer_list="[]", artifact_list="[]")
w = make_walk()
w.core_verb_phase("t2", "t1")
blk = w.result["core_verb"]
check("group A verdicts PASS via the domain witness", blk["verdict"] == "CORE_VERB_PASS")
check("witness triple recorded (object F, list F, domain T)",
      blk["witness"]["writer"] == {"object": False, "list": False, "domain": True})
check("observer domain witness scopes visibility (private)",
      blk["witness"]["observer"]["domain"] is False and blk["observer_sees"] is False)

# Scenario 2 — true fake: no witness sees the object; FAIL stands.
STATE.update(writer_list="[]", observer_list="[]", artifact_list="[]")
w = make_walk()
w.core_verb_phase("t2", "t1")
blk = w.result["core_verb"]
check("true fake still FAILs", blk["verdict"] == "CORE_VERB_FAIL" and blk["persisted"] is False)

# Scenario 3 — artifact list sees it (the pre-W path still works).
STATE.update(writer_list="[]", observer_list="[]", artifact_list='[{"id": "doc-991"}]')
w = make_walk()
w.core_verb_phase("t2", "t1")
blk = w.result["core_verb"]
check("artifact-list witness still carries a PASS",
      blk["verdict"] == "CORE_VERB_PASS" and blk["witness"]["writer"]["list"] is True)

print("FAILURES:", len(FAILS))
sys.exit(1 if FAILS else 0)
