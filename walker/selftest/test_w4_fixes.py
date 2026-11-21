#!/usr/bin/env python3
"""ULW v3 W4 selftest (B2): the four small fixes (GB-1575).

  (1) formfuzz budget: FormFuzz._over_budget honours thresholds.
      formfuzz_budget_s (default 600); _finish attaches the cut cases as
      not_run, names the budget in the notes, and reports each cut case to
      the Reverifier's not_run sink (the carry-over feed).
  (2) DEPLOY_DETECTED: DeployGuard with fakes - a /health pause that
      recovers with the SAME sha is not a deploy; a DIFFERENT sha is; an
      uptime reset during a blackout is; continuous uptime during a
      blackout is not; silence from both witnesses keeps the fail-closed
      stop. The plain same/different paths are unchanged.
  (3) account hygiene: the reverify chat dispatch passes
      write_account_key(cfg); the clickpersist upload path opens its
      driver walk with the write account (source-level, the fleet's
      wiring-test idiom - the recipes themselves need a live browser).
  (4) walker version: lensrecord.walker_sha falls back to a WALKER_SHA
      file (walker dir, then code/ subdir) when git cannot tell; garbage
      files and missing files still yield (None, None).

Fail-on-pristine: no formfuzz_budget_s handling, no confirm window, no
WALKER_SHA fallback pre-W4.
"""
import json, os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker.longwalk import DeployGuard
from concord_walker import lensrecord, sha_gate

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

# --------------------------------------------------------------- (2) guard
class FakeClock:
    def __init__(self):
        self.t = 0.0
        self.sleeps = []
    def __call__(self):
        return self.t
    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s

def seq_fetch(values):
    it = iter(values)
    return lambda: next(it, None)

SHA_A, SHA_B = "a" * 40, "b" * 40

def guard(fetch, uptime=None, window=60):
    fc = FakeClock()
    g = DeployGuard(fetch, log=lambda *a: None, fetch_uptime=uptime,
                    confirm_window_s=window, sleep=fc.sleep, clock=fc)
    return g, fc

# plain paths unchanged
g, _ = guard(seq_fetch([SHA_A] * 4))
ok, _ = g.start()
check("guard start ok", ok and g.active)
check("guard same sha -> no stop", g.check("lens-x") is None)
g, _ = guard(seq_fetch([SHA_A, SHA_B]))
g.start()
check("guard different sha -> stop", (g.check("lens-x") or "").startswith("buildSha changed"))

# pause then recover, same sha -> no stop (the 05:15 case)
g, fc = guard(seq_fetch([SHA_A, None, None, SHA_A]))
g.start()
check("pause-recover same sha -> no stop", g.check("lens-x") is None and fc.t > 0)

# pause then a different sha -> stop, confirmed after the pause
# (_read retries twice internally, so the blackout must outlast one _read)
g, _ = guard(seq_fetch([SHA_A, None, None, SHA_B]))
g.start()
check("pause then different sha -> stop", "confirmed after a /health pause" in (g.check("lens-x") or ""))

# blackout + continuous uptime -> no stop (uptime0 set directly, no start())
g, _ = guard(lambda: None, uptime=lambda: 4600.0)
g.sha, g.active, g.uptime0 = SHA_A, True, 1000.0
check("blackout + continuous uptime -> no stop", g.check("lens-x") is None)

# blackout + uptime reset -> stop
g, _ = guard(lambda: None, uptime=lambda: 12.0)
g.sha, g.active, g.uptime0 = SHA_A, True, 1000.0
check("blackout + uptime reset -> stop", "uptime" in (g.check("lens-x") or ""))

# blackout + no uptime witness -> fail-closed stop survives
g, _ = guard(lambda: None)
g.sha, g.active = SHA_A, True
check("blackout + no witness -> fail-closed stop", "cannot prove no deploy happened" in (g.check("lens-x") or ""))

# health_uptime parsing
check("uptime parses seconds", sha_gate.health_uptime("http://x", fetch=lambda u: json.dumps({"uptime": 3661})) == 3661.0)
check("uptime absent -> None", sha_gate.health_uptime("http://x", fetch=lambda u: json.dumps({"buildSha": SHA_A})) is None)
check("uptime fetch failure -> None", sha_gate.health_uptime("http://x", fetch=lambda u: 1 / 0) is None)

# --------------------------------------------------------------- (1) formfuzz
from concord_walker.formfuzz import FormFuzz
ff = object.__new__(FormFuzz)
ff.budget_s, ff.not_run, ff.lens = 600.0, [], "lens-x"
ff._t0 = None
check("no clock started -> not over budget", ff._over_budget() is False)
now = [1000.0]
ff.clock = lambda: now[0]
ff._t0 = 1000.0
check("inside budget", ff._over_budget() is False)
now[0] = 1601.0
check("past 600s -> over budget", ff._over_budget() is True)

class FakeRV:
    def __init__(self):
        self.not_run = []
ff.rv = FakeRV()
ff.not_run = ["Title/empty", "Date/future"]
out = ff._finish({"verdict": "NEEDS_HUMAN", "notes": "battery incomplete."})
check("_finish attaches not_run", out.get("not_run") == ["Title/empty", "Date/future"])
check("_finish names the budget", "budget 600s reached" in out["notes"])
check("_finish feeds the carry-over sink", [i["check"] for i in ff.rv.not_run] == ["formfuzz:Title/empty", "formfuzz:Date/future"]
      and all(i["slug"] == "lens-x" for i in ff.rv.not_run))
out2 = ff._finish({"verdict": "FIXED", "notes": "clean"}) if not ff.not_run else None
ff.not_run = []
out2 = ff._finish({"verdict": "FIXED", "notes": "clean"})
check("_finish without cuts leaves the result alone", "not_run" not in out2 and out2["notes"] == "clean")

# --------------------------------------------------------------- (3) wiring
SRC = os.path.join(os.path.dirname(__file__), "..", "concord_walker")
reverify_src = open(os.path.join(SRC, "reverify.py")).read()
click_src = open(os.path.join(SRC, "clickpersist.py")).read()
check("chat dispatch routes through write_account_key",
      'run_chat_check(self, t, account=write_account_key(self.cfg)' in reverify_src)
check("upload recipe opens on the write account",
      'cat == "upload"' in click_src and "write_account_key(rv.cfg)" in click_src
      and "account=_acct" in click_src)
check("dead_click/computed keep the walk account",
      "_acct = None" in click_src)

# --------------------------------------------------------------- (4) WALKER_SHA
with tempfile.TemporaryDirectory() as td:
    check("no git, no file -> (None, None)", lensrecord.walker_sha(td) == (None, None))
    with open(os.path.join(td, "WALKER_SHA"), "w") as f:
        f.write(SHA_B + "\n")
    check("WALKER_SHA fallback reads the file", lensrecord.walker_sha(td) == (SHA_B, None))
with tempfile.TemporaryDirectory() as td:
    os.makedirs(os.path.join(td, "code"))
    with open(os.path.join(td, "code", "WALKER_SHA"), "w") as f:
        f.write(SHA_A)
    check("code/WALKER_SHA fallback", lensrecord.walker_sha(td) == (SHA_A, None))
with tempfile.TemporaryDirectory() as td:
    with open(os.path.join(td, "WALKER_SHA"), "w") as f:
        f.write("not-a-sha")
    check("garbage WALKER_SHA -> (None, None)", lensrecord.walker_sha(td) == (None, None))

print()
if FAILS:
    print("W4 FIXES: %d FAILURES: %s" % (len(FAILS), FAILS))
    sys.exit(1)
print("W4 FIXES: ALL PASS")
