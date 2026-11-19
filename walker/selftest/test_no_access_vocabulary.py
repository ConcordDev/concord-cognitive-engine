#!/usr/bin/env python3
"""NO_ACCESS_TEXT vocabulary (H1 gate-card fix): the platform gate card is
a no-access page.

The capture walk (run 20261117-080754) filed five held gates (admin, ops,
psyops, repair-telemetry, system) as "gate did not hold" failures because
the platform gate card -- "Admin access required" / "This operator surface
needs one of: <roles>" -- matched none of NO_ACCESS_TEXT's vocabulary, so
gate_verdict fell through to the failure filing. These legs pin the card's
own wording as no-access (the gate-held page PASSes the gate check), while
a true failure page and ordinary member content still fall through (None)
in both trees, and a benign "needs one of" outside the card's shape does
not convert.

Run: python3 selftest/test_no_access_vocabulary.py
On the pre-fix vocabulary the three gate-card legs FAIL (verdict None);
every control leg holds in both trees (they pin no regression).
"""
import os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import checks

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" " + str(extra)[:300]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def verdict(status, texts, signed_out=False):
    return checks.gate_verdict(status, texts, signed_out)


CARD_HEADING = "Admin access required"
CARD_BODY = "This operator surface needs one of: admin, operator"

# The gate card, in the shapes the a11y tree hands to gate_verdict.
check("gate card heading is no-access", verdict(200, [CARD_HEADING]) == "PASS")
check("gate card body is no-access", verdict(200, [CARD_BODY]) == "PASS")
check("full gate card is no-access", verdict(200, [CARD_HEADING, CARD_BODY]) == "PASS")

# Pre-existing vocabulary and gate shapes: unchanged in both trees.
check("access denied still passes the gate", verdict(200, ["Access denied"]) == "PASS")
check("admin only still passes the gate", verdict(200, ["Admin only"]) == "PASS")
check("permission denied still passes the gate", verdict(200, ["Permission denied"]) == "PASS")
check("status 403 still passes the gate", verdict(403, []) == "PASS")
check("signed-out still passes the gate", verdict(200, [], True) == "PASS")

# Fall-through legs: no verdict in either tree.
check("true 500 page still falls through", verdict(500, ["Internal Server Error"]) is None)
check("ordinary member content falls through", verdict(200, ["Welcome back", "Your dashboard"]) is None)
check("benign needs-one-of falls through", verdict(200, ["This recipe needs one of: butter, oil"]) is None)
check("bare nav label Admin falls through", verdict(200, ["Admin"]) is None)

print()
if FAILS:
    print("FAILURES:", len(FAILS))
    for f in FAILS:
        print(" -", f)
    sys.exit(1)
print("ALL PASS")
