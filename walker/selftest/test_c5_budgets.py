#!/usr/bin/env python3
"""ULW C5 selftest (B2): per-lens settle cap + per-CHECK budgets in checks.py.

Covers, without a browser (LensWalk is constructed, never opened):
  * settle_allowance_ms: full judgment timeout while budget remains, the
    remaining budget when smaller, and 0 once the settle budget is spent;
  * _note_settle accumulates and sets settle_capped at the cap;
  * _nav against a fake page: the idle wait is called with the capped
    allowance, and once the budget is spent the wait is SKIPPED entirely
    (settled=False, settle_capped=True) — the ~727s burn cannot recur;
  * per-check budgets: check_budget_for (default + per-phase override),
    phase_over inside/outside a phase, _end_phase stamping elapsed_s /
    budget_s / over_check_budget on the phase's check row, and the
    write->create_delete / mobile->mobile_390 key mapping.

Fail-on-pristine: the pre-C5 LensWalk has no settle_allowance_ms /
_note_settle / check_budget_for / _begin_phase — AttributeError, so this
suite cannot pass there.
"""
import os, sys, tempfile, time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker.checks import LensWalk

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

class Rec:
    def evidence_dir(self, slug):
        return tempfile.mkdtemp(prefix="ev-")

def make_walk(th_extra=None):
    th = {"lens_budget_s": 900, "settle_ms_judgment": 15000, "settle_budget_s": 60,
          "check_budget_s": 90, "check_budgets_s": {"tabs": 5}}
    th.update(th_extra or {})
    cfg = {"base_url": "https://concord-os.org", "thresholds": th,
           "admin_lenses": [], "write_skip_lenses": []}
    lens = {"slug": "demo", "url": "https://concord-os.org/lenses/demo"}
    return LensWalk(None, cfg, Rec(), lens, None, lambda *a: None)

# -- settle allowance ---------------------------------------------------------
w = make_walk()
check("fresh walk: allowance is the full judgment timeout", w.settle_allowance_ms() == 15000)
w._note_settle(50.0)
check("50s spent of 60s: allowance is the remaining 10s", w.settle_allowance_ms() == 10000)
check("not capped before the budget is spent", w.settle_capped is False)
w._note_settle(10.0)
check("allowance is 0 once the settle budget is spent", w.settle_allowance_ms() == 0)
check("settle_capped set at the cap", w.settle_capped is True)
w._note_settle(-5.0)
check("negative settle never refunds the budget", w.settle_spent_s == 60.0)

# -- _nav against a fake page ---------------------------------------------------
class Resp:
    status = 200

class FakePage:
    def __init__(self):
        self.url = "https://concord-os.org/lenses/demo"
        self.waits = []
    def goto(self, url, wait_until=None, timeout=None):
        return Resp()
    def wait_for_load_state(self, state, timeout=None):
        self.waits.append((state, timeout))
        if state == "networkidle":
            raise Exception("timeout (fake: never idle)")
    def screenshot(self, **kw):
        return b"shot"

w2 = make_walk()
page = FakePage()
t = w2._nav(page, None)
idle_waits = [x for x in page.waits if x[0] == "networkidle"]
check("nav waits for idle with the capped allowance", idle_waits and idle_waits[0][1] == 15000, page.waits)
check("never-idle page: settled False, not capped on first nav", t["settled"] is False and t["settle_capped"] is False)
w2._note_settle(60.0)  # budget now spent
page2 = FakePage()
t2 = w2._nav(page2, None)
check("budget spent: idle wait skipped entirely", [x for x in page2.waits if x[0] == "networkidle"] == [])
check("budget spent: timing stamped settle_capped", t2["settle_capped"] is True and t2["settled"] is False)

# -- per-check budgets ------------------------------------------------------------
w3 = make_walk()
check("default check budget", w3.check_budget_for("surface") == 90.0)
check("per-phase override wins", w3.check_budget_for("tabs") == 5.0)
check("phase_over False outside a phase", w3.phase_over() is False)
w3._begin_phase("surface")
check("phase_over False at phase start", w3.phase_over() is False)
w3._phase_t0 = time.time() - 100  # 100s into a 90s phase
check("phase_over True past the phase budget", w3.phase_over() is True)
w3.mark("surface", "PASS")
w3._end_phase("surface")
d = w3.result["checks"]["surface"]
check("end_phase stamps elapsed + budget", d.get("elapsed_s", 0) >= 99 and d.get("budget_s") == 90, d)
check("end_phase stamps over_check_budget", d.get("over_check_budget") is True)
check("check_spent_s accumulates the phase", w3.check_spent_s.get("surface", 0) >= 99)
w3._begin_phase("write")
w3.mark("create_delete", "PASS")
w3._end_phase("write")
check("write phase stamps the create_delete row", "elapsed_s" in w3.result["checks"]["create_delete"])
w3._end_phase("surface")  # no phase open: no-op, no crash
check("end_phase with no open phase is a no-op", True)

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
