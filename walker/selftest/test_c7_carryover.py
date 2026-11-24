#!/usr/bin/env python3
"""ULW C7 selftest (B2): the NOT_RUN carry-over queue (carryover.py).

Covers: queueing from a LensWalk result (NOT_RUN only, deduped by
(slug, check), first reason kept), exactly one revisit per pending item
on drain, outcomes recorded (a revisit that resolves the check clears it
from remaining; one that does not keeps it queued with its new reason),
a revisit exception recorded as ERROR (never propagated, never dropped),
and the carryover.json record shape.

Fail-on-pristine: concord_walker.carryover does not exist pre-C7 —
ImportError, so this suite cannot pass there.
"""
import json, os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker.carryover import CarryoverQueue

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

q = CarryoverQueue()
res = {"slug": "demo", "checks": {
    "tabs": {"status": "NOT_RUN", "reason": "lens time budget exceeded"},
    "export": {"status": "NOT_RUN", "reason": "renderer crashed"},
    "surface": {"status": "PASS"},
    "timing": {"status": "FAIL"}}}
q.add_from_result(res)
q.add_from_result(res)  # duplicate feed: deduped
check("only NOT_RUN checks queue, deduped", sorted((i["slug"], i["check"]) for i in q.pending()) == [("demo", "export"), ("demo", "tabs")], q.items)
check("first reason kept", q.items[("demo", "tabs")]["reason"] == "lens time budget exceeded")

calls = []
def revisit(it):
    calls.append(it["check"])
    if it["check"] == "tabs":
        return ("PASS", None)
    return ("NOT_RUN", "still blocked: no dialog")

out = q.drain(revisit)
check("exactly one revisit per pending item", sorted(calls) == ["export", "tabs"], calls)
check("resolved check leaves the queue", [i["check"] for i in q.remaining()] == ["export"])
check("unresolved check stays with its new reason", q.items[("demo", "export")]["last_reason"] == "still blocked: no dialog")
check("revisit counts recorded", q.items[("demo", "tabs")]["revisits"] == 1 and q.items[("demo", "export")]["revisits"] == 1)
check("drain returns the outcomes", len(out) == 2)

def boom(it):
    raise RuntimeError("revisit blew up")
out2 = q.drain(boom)
check("revisit exception recorded as ERROR, not propagated", q.items[("demo", "export")]["last_status"] == "ERROR" and "revisit blew up" in q.items[("demo", "export")]["last_reason"])
check("ERROR item is not pending (it was attempted, outcome recorded)", q.remaining() == [])

d = tempfile.mkdtemp(prefix="co-")
path = q.write(d)
data = json.load(open(path))
check("carryover.json written with items + remaining count", os.path.basename(path) == "carryover.json" and len(data["items"]) == 2 and data["remaining"] == 0)

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
