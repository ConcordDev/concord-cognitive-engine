#!/usr/bin/env python3
"""WALK-05 budget-hook selftest (B2): the checks.py LensWalk hook.

Covers, without a browser (LensWalk is constructed, never opened):
  * LensBudget.note/spent accumulate finished-walk time (runstate);
  * the per-walk cap leg of over_budget() (the pre-hook behaviour, intact);
  * the cumulative leg: a FRESH walk on a lens whose run-shared budget is
    already spent is over budget immediately — the defect the hook closes
    (before it, every re-walk of a lens got a fresh full budget);
  * _note_budget stamps result["budget"] + result["budget_aborted"] (only
    the phases the budget stopped, never other NOT_RUNs) and notes the
    walk's elapsed into the tracker exactly once.

Fail-on-pristine: on the pre-hook walker, LensWalk has no `budget` kwarg
and LensBudget has no note/spent — construction raises TypeError /
AttributeError, so this suite cannot pass there.
"""
import os, sys, tempfile, time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker.checks import LensWalk
from concord_walker.runstate import LensBudget

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

class Rec:
    def evidence_dir(self, slug):
        return tempfile.mkdtemp(prefix="ev-")

def make_walk(budget=None, budget_s=900):
    cfg = {"base_url": "https://concord-os.org",
           "thresholds": {"lens_budget_s": budget_s},
           "admin_lenses": [], "write_skip_lenses": []}
    lens = {"slug": "demo", "url": "https://concord-os.org/lenses/demo"}
    return LensWalk(None, cfg, Rec(), lens, None, lambda *a: None, budget=budget)

# -- tracker accumulation -----------------------------------------------------
b = LensBudget(900)
b.note("demo", 100.0)
b.note("demo", 50.0)
b.note("other", 5.0)
check("note/spent accumulate per lens", b.spent("demo") == 150.0 and b.spent("other") == 5.0 and b.spent("never") == 0.0)
b.note("demo", -3.0)
check("note clamps negative seconds", b.spent("demo") == 150.0)

# -- per-walk leg (pre-hook behaviour intact) ----------------------------------
w = make_walk()
check("fresh walk, no tracker: not over budget", w.over_budget() is False)
w.t_start = time.time() - 1000
check("per-walk cap still fires (elapsed > lens_budget_s)", w.over_budget() is True)

# -- cumulative leg -------------------------------------------------------------
b2 = LensBudget(900)
b2.note("demo", 950.0)  # earlier walks of this lens already spent the budget
w2 = make_walk(budget=b2)
check("fresh walk, spent lens: over budget immediately", w2.over_budget() is True)
b3 = LensBudget(900)
b3.note("demo", 100.0)
w3 = make_walk(budget=b3)
check("fresh walk, partly spent lens: not over budget", w3.over_budget() is False)

# -- _note_budget stamping -------------------------------------------------------
b4 = LensBudget(900)
w4 = make_walk(budget=b4)
w4.mark("tabs", "NOT_RUN", reason="lens time budget exceeded")
w4.mark("export", "NOT_RUN", reason="lens time budget exceeded")
w4.mark("write", "NOT_RUN", reason="read-only run")
w4._note_budget()
check("budget_aborted lists only budget-stopped phases",
      w4.result.get("budget_aborted") == ["tabs", "export"], w4.result.get("budget_aborted"))
check("result budget stamp carries lens + budget_s", w4.result["budget"]["lens"] == "demo" and w4.result["budget"]["budget_s"] == 900)
check("walk elapsed noted into the tracker", b4.spent("demo") > 0)
spent_after_first = b4.spent("demo")
w4._note_budget()
check("second _note_budget does not double-note", b4.spent("demo") == spent_after_first)

w5 = make_walk()  # no tracker: stamp still written, no budget_aborted when none stopped
w5._note_budget()
check("no-tracker stamp: budget present, spent == elapsed, no aborted key",
      w5.result["budget"]["spent_s"] == w5.result["budget"]["elapsed_s"] and "budget_aborted" not in w5.result)

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
