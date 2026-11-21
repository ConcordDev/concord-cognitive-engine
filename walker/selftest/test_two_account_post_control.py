#!/usr/bin/env python3
"""CB-1056: the two-account leg's false-positive control for non-GET replays.

Walk 3 filed thread OWNERSHIP_FAIL on a bare 200: the replayed call was the
page-load thread.draft-list — a READ riding POST, as every lens.run action
does — and the handler keys every row to the caller (actor-scoped), so the
foreign account received its OWN empty draft list. cross_account's payload
controls covered GET replays only. This suite pins the non-GET control:
re-issue the identical call as the owner and compare payloads in memory —
identical non-empty payload = OWNERSHIP_FAIL; different = SCOPED; empty
foreign payload = EMPTY; unknown comparison = the FAIL stands.

No browser, no network (the c28 harness idiom: fake contexts, per-account
payload tables)."""
import os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)

from concord_walker import auth, checks
import concord_walker.intended_public as _ip

FAILS = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)

ACCTS = {"t1": {"username": "a"}, "t2": {"username": "b"}}
def cfg_default():
    return {"accounts": dict(ACCTS), "base_url": "https://example.test",
            "viewport_desktop": {"width": 1, "height": 1}}

TABLE = {}   # acct -> payload dict, or an Exception instance to raise
CALLS = []   # (acct, method, url)

class Resp:
    def __init__(self, payload): self._p = payload; self.status = 200
    def json(self): return self._p

class Req:
    def __init__(self, acct): self.acct = acct
    def _go(self, method, url):
        CALLS.append((self.acct, method, url))
        v = TABLE[self.acct]
        if isinstance(v, Exception):
            raise v
        return Resp(v)
    def fetch(self, url, method="GET", **kw): return self._go(method, url)
    def get(self, url, **kw): return self._go("GET", url)

class Ctx:
    def __init__(self, acct): self.request = Req(acct); self.acct = acct
    def close(self): pass

def make_walk(replay):
    w = object.__new__(checks.LensWalk)
    w.cfg, w.acct, w.admin, w.b, w.log = cfg_default(), "t1", False, None, None
    w.th = {}; w.result = {}; w.allow_write = True; w.two_account = False; w.slug = "thread"
    w.net = types.SimpleNamespace(replay=replay, _cid_at=lambda t: "load:page:-",
                                  annotate=lambda *a, **k: None, meta={})
    w._anon_get = lambda url: None
    w._premap_finding = lambda *a, **k: None
    return w

checks.new_context = lambda b, cfg, acct, vp, mobile=False: Ctx(acct)
checks.assert_account = lambda ctx, cfg, acct, *a, **k: None
auth.has_session = lambda cfg, key: key in cfg["accounts"]
_ip.load = lambda *a, **k: []

POST_RUN = {"t": 1, "method": "POST", "url": "https://example.test/api/lens/thread/abc123/run",
            "path": "/api/lens/thread/:id/run", "post": '{"action": "draft-list"}', "acct": "t1"}

def run_case(table, replay=None):
    TABLE.clear(); TABLE.update(table); CALLS.clear()
    w = make_walk(replay if replay is not None else [dict(POST_RUN)])
    w.cross_account()
    return w.result["two_account"]

# 1. actor-scoped POST (the thread draft-list shape): the foreign account's
#    payload is its OWN data, different from the owner's -> SCOPED, no fail.
ta = run_case({"t2": {"drafts": [{"id": "f1", "title": "mine"}], "count": 1},
               "t1": {"drafts": [{"id": "o1", "title": "theirs"}], "count": 1}})
row = ta["calls"][0]
check("actor-scoped POST -> SCOPED", row["verdict"] == "SCOPED")
check("actor-scoped POST -> block PASS, no ownership failures",
      ta["status"] == "PASS" and ta["ownership_failures"] == 0 and ta["scoped"] == 1)
check("control re-issued the call as the owner",
      ("t1", "POST", POST_RUN["url"]) in CALLS and row.get("same_as_owner") is False)

# 2. owner-data POST: identical non-empty payloads -> the FAIL stands.
ta = run_case({"t2": {"drafts": [{"id": "o1", "title": "theirs"}], "count": 1},
               "t1": {"drafts": [{"id": "o1", "title": "theirs"}], "count": 1}})
row = ta["calls"][0]
check("owner-data POST -> OWNERSHIP_FAIL", row["verdict"] == "OWNERSHIP_FAIL")
check("owner-data POST -> block FAIL", ta["status"] == "FAIL" and ta["ownership_failures"] == 1)

# 3. empty foreign payload (t3's empty draft list) -> EMPTY, counted scoped.
ta = run_case({"t2": {"drafts": [], "count": 0},
               "t1": {"drafts": [{"id": "o1"}], "count": 1}})
row = ta["calls"][0]
check("empty foreign POST payload -> EMPTY", row["verdict"] == "EMPTY")
check("empty foreign POST -> block PASS, scoped counts it",
      ta["status"] == "PASS" and ta["scoped"] == 1)

# 4. owner re-issue unknown (owner fetch raises) -> conservative: FAIL stands.
ta = run_case({"t2": {"drafts": [{"id": "x"}], "count": 1},
               "t1": RuntimeError("boom")})
row = ta["calls"][0]
check("unknown comparison -> OWNERSHIP_FAIL stands", row["verdict"] == "OWNERSHIP_FAIL")

# 5. GET control untouched: differing payloads -> SCOPED via the old control.
get_row = {"t": 1, "method": "GET", "url": "https://example.test/api/notes/9",
           "path": "/api/notes/:id", "post": None, "acct": "t1"}
ta = run_case({"t2": {"items": [1]}, "t1": {"items": [2]}}, replay=[get_row])
check("GET differing payload -> SCOPED (old control intact)",
      ta["calls"][0]["verdict"] == "SCOPED")

print("FAILURES:", len(FAILS))
sys.exit(1 if FAILS else 0)
