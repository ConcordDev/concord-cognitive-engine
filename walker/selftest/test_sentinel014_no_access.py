#!/usr/bin/env python3
"""sentinel-014 NO_ACCESS pin: the shield gate's denial is no-access text.

sentinel-014 (founder ruling "Restrict to admins", 2026-11-19) admin-gates
the five platform-wide shield macros (firewall - metrics - predictions -
threats - sweep) in server/server.js. A non-admin caller now receives the
platform denial envelope { ok:false, error:"Insufficient permissions:
admin role required" }. Walk 2 covers sentinel as a member lens (gate
receipt ruling (3)), so the walk exercises exactly this blocked state:
the denial text must classify as NO_ACCESS - the gate holding - and never
as an error finding, while the member-facing sentinel surface (which
stays up: shield tab, security score, threat panels' empty states) must
not be swallowed by the vocabulary.

These legs pin that classification against the landed denial text. The
vocabulary itself already carries "insufficient permission" (the CB-0872
gate-card addition); this pin locks the sentinel gate to it so a future
vocabulary edit cannot silently un-cover the gate.

Run: python3 selftest/test_sentinel014_no_access.py
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


DENIAL = "Insufficient permissions: admin role required"

# 1. The gate's denial text is NO_ACCESS vocabulary.
check("denial text matches NO_ACCESS_TEXT", bool(checks.NO_ACCESS_TEXT.search(DENIAL)))

# 2. Where a gate verdict is consulted, the denial reads as the gate holding.
check("gate_verdict passes on the denial text",
      checks.gate_verdict(200, [DENIAL], False) == "PASS")

# 3. The denial is not error text: the member walk's reach scan must not
#    file the blocked shield state as a load failure.
check("denial text is not ERROR_TEXT", not checks.ERROR_TEXT.search(DENIAL))
check("denial text is not STATUS_TEXT", not checks.STATUS_TEXT.search(DENIAL))

# 4. Benign member-surface text stays outside the vocabulary - the pin
#    must not convert sentinel's member surface into a gate page.
for text in ["Shield", "Threat feed", "Run full sweep", "Security score",
             "No threats detected", "Firewall rules", "Predictions"]:
    check("benign member text not NO_ACCESS: %r" % text,
          not checks.NO_ACCESS_TEXT.search(text))

print("FAILURES: %d" % len(FAILS))
sys.exit(1 if FAILS else 0)
