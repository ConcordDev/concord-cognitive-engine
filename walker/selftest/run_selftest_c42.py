#!/usr/bin/env python3
"""SELFTEST C42 — money-row verification legs on the SB-38 DB clone (ULW C42).

Browser-free: exercises the money-row selection, the fail-closed clone
gate, the permit-scoped step decisions, and the repro routing on stubs.
The legs themselves fire clone-side in walk 2, at the walker desk.

Run:  python3 selftest/run_selftest_c42.py
Exit: 0 = all pass. Against a pristine tree (no clone_legs) the import
fails and the run FAILS — the discrimination control.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from concord_walker import clone_legs                      # noqa: E402  (absent on pristine -> FAIL)
from concord_walker.clone_legs import CloneGate, CloneRefused  # noqa: E402
from concord_walker.repro import _step_decision            # noqa: E402

RESULTS = []


def check(name, cond):
    RESULTS.append((name, bool(cond)))
    print("%s %s" % ("PASS" if cond else "FAIL", name))


CFG = {
    "fixture_prefix": "qa-walker",
    "base_url": "https://concord-os.org",
    "write_skip_lenses": ["social", "feed", "marketplace"],
    "admin_lenses": ["admin"],
    "accounts": {"t1": {}, "t2": {}, "admin": {}},
    "clone": {"base_url": "http://clone.local:5099",
              "health_marker": {"db": "sb38-clone", "env": "clone"}},
    "thresholds": {},
}


class Rec:
    rid = "run-20261119-abcdef"
    run_dir = "/tmp"

    def __init__(self):
        self.fixtures = {}

    def fixture(self, label, lens, state, note=""):
        self.fixtures[label] = {"label": label, "lens": lens, "state": state}


# ---------------------------------------------------------------- C42
check("C42 is_money_row: purchase row", clone_legs.is_money_row({"title": "Buy button charges twice", "actual": "", "expected": "", "repro": ""}))
check("C42 is_money_row: plain row", not clone_legs.is_money_row({"title": "Heading misaligned", "actual": "", "expected": "", "repro": ""}))

gate = CloneGate(CFG)
HEALTH = {"db": "sb38-clone", "env": "clone", "ok": True}
permit = gate.permit("http://clone.local:5099", HEALTH)
check("C42 gate: clone target + markers -> permit", isinstance(permit, clone_legs.ClonePermit))
for url, health, why in [
    ("https://concord-os.org", HEALTH, "prod URL refused"),
    ("http://other.local:5099", HEALTH, "wrong URL refused"),
    ("http://clone.local:5099", {"db": "prod"}, "marker mismatch refused"),
    ("http://clone.local:5099", None, "non-dict health refused"),
]:
    try:
        gate.permit(url, health)
        check("C42 gate: %s" % why, False)
    except CloneRefused:
        check("C42 gate: %s" % why, True)
try:
    CloneGate({"base_url": "https://x"}).permit("http://clone.local:5099", HEALTH)
    check("C42 gate: unconfigured gate refuses", False)
except CloneRefused:
    check("C42 gate: unconfigured gate refuses", True)

ok, _, kind = clone_legs.clone_step_decision("Buy now", None)
check("C42 decision: purchase WITHOUT permit refused", not ok)
ok, _, kind = clone_legs.clone_step_decision("Buy now", permit)
check("C42 decision: purchase WITH permit allowed as payment", ok and kind == "payment")
ok, _, _ = clone_legs.clone_step_decision("Transfer funds", permit)
check("C42 decision: transfer denied even under permit", not ok)
ok, _, _ = clone_legs.clone_step_decision("Withdraw", permit)
check("C42 decision: withdraw denied even under permit", not ok)
ok, _, _ = clone_legs.clone_step_decision("Buy now", permit, admin=True)
check("C42 decision: admin refused under permit", not ok)
ok, _, kind = clone_legs.clone_step_decision("Save", permit, fixture_labels=["qa-walker-market-clone-x"])
check("C42 decision: plain create delegates to base rule", ok and kind == "create")

rec2 = Rec()
rec2.fixtures = {
    "qa-walker-market-clone-abcdef-fixmarket001": {"label": "qa-walker-market-clone-abcdef-fixmarket001", "lens": "marketplace", "state": "live"},
    "qa-walker-market-t1-abcdef-z": {"label": "qa-walker-market-t1-abcdef-z", "lens": "marketplace", "state": "live"},
}
cctx = clone_legs.clone_write_ctx(CFG, rec2, {"lens": "marketplace", "id": "FIX-market-001"}, permit)
check("C42 clone ctx: -clone- label stem", "-clone-" in cctx["label_base"])
check("C42 clone ctx: fixtures admit clone labels only", cctx["fixtures"]() == ["qa-walker-market-clone-abcdef-fixmarket001"])
try:
    clone_legs.clone_write_ctx(CFG, rec2, {"lens": "marketplace", "id": "X"}, None)
    check("C42 clone ctx: no permit -> refused", False)
except CloneRefused:
    check("C42 clone ctx: no permit -> refused", True)

ok, _, _ = _step_decision({"admin": False, "write_skip": False}, "Buy now", [])
check("C42 repro routing: no permit in ctx -> purchase refused", not ok)
ok, _, kind = _step_decision({"admin": False, "write_skip": False, "clone_permit": permit}, "Buy now", [])
check("C42 repro routing: permit in ctx -> purchase allowed", ok and kind == "payment")

plan = clone_legs.plan_clone_legs([
    {"id": "FIX-a-001", "title": "Checkout total wrong"},
    {"id": "FIX-b-002", "title": "Tab order wrong"},
    {"id": "FIX-c-003", "title": "Refund button missing"},
])
check("C42 plan selects exactly the money rows", plan == ["FIX-a-001", "FIX-c-003"])

fails = [n for n, c in RESULTS if not c]
print("SELFTEST-C42 %s %d/%d" % ("PASS" if not fails else "FAIL", len(RESULTS) - len(fails), len(RESULTS)))
sys.exit(0 if not fails else 1)
