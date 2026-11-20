#!/usr/bin/env python3
"""ULW C28 runtime isolation wiring self-test (t1362s16084: t2 writes, t1 observes).

No browser, no network. Pins the RUNTIME legs, not just preflight:
  * auth.isolation_pair: default config -> (walk acct, "t2") (pre-C28, unchanged);
    write_account t2 + isolation_observer t1 -> ("t2", "t1").
  * isolation.phase_plan: observer session gate names the observer; default text unchanged.
  * NetLedger.attach(page, account=...) tags every recorded call with its context's account.
  * LensWalk.cross_account: walk-2 replays ONLY the writer t2's calls, as t1 (t1's own read
    calls are never replayed as t1); the owner-side comparison opens the row's owner (t2).
    Default config: t1's calls replayed as t2, compared against t1 (unchanged).
  * LensWalk.isolation_phase: walk-2 opens the OWNER context as t2 and probes with t1.
  * privacy_checks.probe_foreign_rows: probing contexts = observer + signed-out; the owner
    guard checks the owner account; owner == probing account -> NEEDS_HUMAN, never a verdict.
"""
import os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)

from concord_walker import auth, isolation, checks, privacy_checks, netledger

FAILS = []
def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)

ACCTS = {"t1": {"username": "a"}, "t2": {"username": "b"}}
def cfg_default():
    return {"accounts": dict(ACCTS), "base_url": "https://example.test", "viewport_desktop": {"width": 1, "height": 1}}
def cfg_walk2():
    c = cfg_default(); c["write_account"] = "t2"; c["isolation_observer"] = "t1"; return c

# ---- auth.isolation_pair
check("pair default", auth.isolation_pair(cfg_default(), "t1") == ("t1", "t2"))
check("pair walk2", auth.isolation_pair(cfg_walk2(), "t1") == ("t2", "t1"))
c = cfg_default(); c["write_account"] = "tw"; c["accounts"]["tw"] = {"username": "w"}
check("pair default+tw writer", auth.isolation_pair(c, "t1") == ("tw", "t2"))

# ---- isolation.phase_plan
p = isolation.phase_plan(acct="t1", admin=False, allow_write=True, has_t2=False)
check("plan default reason unchanged", p["reason"] == "no saved t2 session (auth/t2.json)")
p = isolation.phase_plan(acct="t1", admin=False, allow_write=True, has_t2=False, observer="t1")
check("plan observer reason", p["reason"] == "no saved t1 session (auth/t1.json)")
p = isolation.phase_plan(acct="t1", admin=False, allow_write=True, has_t2=True, observer="t1")
check("plan walk2 runs", p["run"] is True)

# ---- NetLedger tagging
class FakePage:
    def __init__(self): self.h = {}
    def on(self, ev, fn): self.h[ev] = fn
nl = netledger.NetLedger("https://example.test", stamp={})
pg = FakePage(); nl.attach(pg, account="t2")
req = types.SimpleNamespace(url="https://example.test/api/notes/123", resource_type="fetch", method="GET")
pg.h["request"](req)
check("netledger tags account", nl.raw and nl.raw[-1].get("acct") == "t2")
pg1 = FakePage(); nl.attach(pg1)
pg1.h["request"](req)
check("netledger untagged default None", nl.raw[-1].get("acct") is None)

# ---- cross_account
class Resp:
    status = 403
    def json(self): return {"ok": False}
class Req:
    def __init__(self, log, acct): self.log, self.acct = log, acct
    def fetch(self, url, method="GET", **kw): self.log.append((self.acct, method, url)); return Resp()
    def get(self, url, **kw): self.log.append((self.acct, "GET", url)); return Resp()
class Ctx:
    def __init__(self, log, acct): self.request = Req(log, acct); self.acct = acct
    def close(self): pass

def make_walk(cfg, replay):
    w = object.__new__(checks.LensWalk)
    w.cfg, w.acct, w.admin, w.b, w.log = cfg, "t1", False, None, None
    w.th = {}; w.result = {}; w.allow_write = True; w.two_account = False; w.slug = "notes"
    w.net = types.SimpleNamespace(replay=replay, _cid_at=lambda t: "c:btn:x", annotate=lambda *a, **k: None, meta={})
    w._anon_get = lambda url: None
    w._premap_finding = lambda *a, **k: None
    return w

opened, calls, asserted = [], [], []
def fake_new_context(b, cfg, acct, vp, mobile=False):
    opened.append(acct); return Ctx(calls, acct)
orig = (checks.new_context, checks.assert_account, auth.has_session)
checks.new_context = fake_new_context
checks.assert_account = lambda ctx, cfg, acct, *a, **k: asserted.append(acct)
auth.has_session = lambda cfg, key: key in cfg["accounts"]
import concord_walker.intended_public as _ip
_ip_load = _ip.load; _ip.load = lambda *a, **k: []

replay = [{"t": 1, "method": "GET", "url": "https://example.test/api/notes/1", "path": "/api/notes/:id", "post": None, "acct": "t1"},
          {"t": 2, "method": "GET", "url": "https://example.test/api/notes/2", "path": "/api/notes/:id/x", "post": None, "acct": "t2"},
          {"t": 3, "method": "GET", "url": "https://example.test/api/x/3", "path": "/api/x/:id", "post": None}]
w = make_walk(cfg_walk2(), replay); opened[:] = []; calls[:] = []
w.cross_account()
ta = w.result["two_account"]
check("walk2 replay uses t1 context", opened == ["t1"])
check("walk2 replays only t2-owned call", [c[2] for c in calls] == ["https://example.test/api/notes/2"])
check("walk2 row owner/foreign", ta["calls"][0]["owner"] == "t2" and ta["calls"][0]["foreign"] == "t1")

w = make_walk(cfg_default(), [dict(r, acct=None) if r.get("acct") == "t2" else r for r in replay[:1]] + [replay[2]])
opened[:] = []; calls[:] = []
w.cross_account()
check("default replay uses t2 context", opened == ["t2"])
check("default replays all t1 calls", len(calls) == 2 and w.result["two_account"]["replayed"] == 2)

# owner-side comparison opens the row's owner
same_owner = []
class Resp200:
    status = 200
    def json(self): return {"items": [1]}
class Req200(Req):
    def fetch(self, url, method="GET", **kw): self.log.append((self.acct, method, url)); return Resp200()
checks.new_context = lambda b, cfg, acct, vp, mobile=False: (opened.append(acct), types.SimpleNamespace(request=Req200(calls, acct), close=lambda: None))[1]
w = make_walk(cfg_walk2(), replay[1:2]); opened[:] = []
w._same_as_t1 = lambda url, body, vp, owner="t1": (same_owner.append(owner), (False, {"items": [2]}))[1]
w.cross_account()
check("walk2 comparison against owner t2", same_owner == ["t2"] and w.result["two_account"]["calls"][0]["verdict"] == "SCOPED")

# ---- isolation_phase
probe_args = {}
def fake_probe(walk, ctx, label, paths, log=None, owner_acct=None, foreign_acct="t2"):
    probe_args.update(owner=owner_acct, foreign=foreign_acct, ctx_acct=ctx.acct)
    return {"verdict": "FIXED", "method": "privacy:foreign-rows", "notes": "", "leaks": []}
orig_probe = privacy_checks.probe_foreign_rows; privacy_checks.probe_foreign_rows = fake_probe
def run_phase(cfg):
    w = make_walk(cfg, [{"t": 1, "method": "GET", "url": "u", "path": "/api/notes/:id", "post": None, "acct": "t2"}])
    w.rec = types.SimpleNamespace(fixtures={"f": {"lens": "notes", "state": "live", "label": "ULW-label"}})
    w.cross_account = lambda: None
    w.over_budget = lambda: False
    w._close = lambda ctx: None
    w.open = lambda mobile=False, account=None: (Ctx([], account or w.acct), None, None)
    probe_args.clear(); w.isolation_phase(); return w
w = run_phase(cfg_walk2())
check("phase walk2 owner ctx t2 / probe t1", probe_args == {"owner": "t2", "foreign": "t1", "ctx_acct": "t2"})
w = run_phase(cfg_default())
check("phase default owner t1 / probe t2", probe_args == {"owner": "t1", "foreign": "t2", "ctx_acct": "t1"})
privacy_checks.probe_foreign_rows = orig_probe

# ---- probe_foreign_rows contexts
pc_opened, pc_asserted = [], []
class PCtx:
    def __init__(self, acct): self.acct = acct; self.request = types.SimpleNamespace(get=lambda u, **k: types.SimpleNamespace(text=lambda: "{}"))
    def new_page(self): return types.SimpleNamespace(goto=lambda *a, **k: None)
    def close(self): pass
pc_orig = (privacy_checks.new_context, privacy_checks.assert_account, privacy_checks.Cdp)
privacy_checks.new_context = lambda b, cfg, acct, vp: (pc_opened.append(acct), PCtx(acct))[1]
privacy_checks.assert_account = lambda ctx, cfg, acct, *a, **k: pc_asserted.append(acct)
privacy_checks.Cdp = lambda ctx, page: types.SimpleNamespace(ax=lambda: types.SimpleNamespace(texts=lambda: ["nothing here"]))
walk = types.SimpleNamespace(cfg=cfg_walk2(), b=None, acct="t1", url="https://example.test/lenses/notes")
row = privacy_checks.probe_foreign_rows(walk, PCtx("t2"), "ULW-label", ["/api/notes"], None, owner_acct="t2", foreign_acct="t1")
check("probe walk2 owner guard t2 then t1", pc_asserted == ["t2", "t1"] and pc_opened == ["t1", None])
check("probe walk2 verdict FIXED + notes", row["verdict"] == "FIXED" and "absent from t1" in row["notes"])
pc_opened[:] = []; pc_asserted[:] = []
row = privacy_checks.probe_foreign_rows(walk, PCtx("t1"), "ULW-label", ["/api/notes"], None, owner_acct="t1", foreign_acct="t1")
check("probe owner==observer refused", row["verdict"] == "NEEDS_HUMAN" and pc_opened == [])
walk = types.SimpleNamespace(cfg=cfg_default(), b=None, acct="t1", url="u")
pc_opened[:] = []; pc_asserted[:] = []
row = privacy_checks.probe_foreign_rows(walk, PCtx("t1"), "ULW-label", ["/api/notes"], None)
check("probe default t1 owner / t2 probe (unchanged)", pc_asserted == ["t1", "t2"] and pc_opened == ["t2", None]
      and row["notes"].startswith("label absent from t2 + signed-out"))

privacy_checks.new_context, privacy_checks.assert_account, privacy_checks.Cdp = pc_orig
checks.new_context, checks.assert_account, auth.has_session = orig
_ip.load = _ip_load
print("c28 runtime isolation: %d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
