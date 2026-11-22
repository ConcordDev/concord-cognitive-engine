"""CB-1240 FIX 4 (four-fix rerun): the per-lens budget must be able to match
the outer budget (1,200 s cap) instead of biting at the old 240 s config
value, on BOTH run commands.

Pins: (1) config thresholds.lens_budget_s == 1200; (2) --lens-budget-s is
accepted by sweep, lens and reverify; (3) cmd_walk wires the flag into its
LensBudget exactly as cmd_reverify does; (4) LensBudget semantics: a lens
under its budget is not over, a lens past it is.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER_DIR = os.path.dirname(HERE)
sys.path.insert(0, WALKER_DIR)

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" — " + detail) if detail and not cond else ""))
    if not cond:
        FAILS.append(name)

# (1) config value
cfg = json.load(open(os.path.join(WALKER_DIR, "config.json")))
check("config thresholds.lens_budget_s == 1200", cfg["thresholds"]["lens_budget_s"] == 1200,
      "got %r" % cfg["thresholds"].get("lens_budget_s"))

# (2) CLI surface
for cmd in ("sweep", "lens", "reverify"):
    r = subprocess.run([sys.executable, os.path.join(WALKER_DIR, "walker.py"), cmd, "--help"],
                       capture_output=True, text=True, timeout=60)
    check("%s --help lists --lens-budget-s" % cmd, "--lens-budget-s" in r.stdout)

# (3) wiring pins
src = open(os.path.join(WALKER_DIR, "walker.py")).read()
check("cmd_walk LensBudget reads args.lens_budget_s",
      'LensBudget(getattr(args, "lens_budget_s", None) or cfg["thresholds"]["lens_budget_s"])' in src)
check("cmd_reverify LensBudget reads args.lens_budget_s",
      'LensBudget(getattr(args, "lens_budget_s", None) or cfg.get("thresholds", {}).get("lens_budget_s", 900))' in src)

# (4) LensBudget semantics
from concord_walker.runstate import LensBudget
b = LensBudget(1200); b.start("demo")
check("lens under a 1200 s budget is not over", b.over("demo") is False)
b2 = LensBudget(-1); b2.start("demo")
check("lens past its budget is over", b2.over("demo") is True)
check("unstarted lens is never over", LensBudget(0).over("never-started") is False)

print("FAILURES: %d" % len(FAILS))
sys.exit(1 if FAILS else 0)
