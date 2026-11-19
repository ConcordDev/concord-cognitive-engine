#!/usr/bin/env python3
"""ULW C9 selftest (B2): crash = relaunch + re-run the same unit (crashretry.py).

Covers: a clean run (no relaunch), a crash then success on the SAME unit
(exactly one relaunch, result returned, relaunches_used == 1), a crash
after the last relaunch raising CrashExhausted carrying the unit + last
error (so the caller fails that unit alone), and a non-crash error
propagating untouched with NO relaunch.

Fail-on-pristine: concord_walker.crashretry does not exist pre-C9 —
ImportError, so this suite cannot pass there.
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker.crashretry import run_with_relaunch, CrashExhausted

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

class TargetClosedError(Exception):
    pass

def is_crash(e):
    return isinstance(e, TargetClosedError)

relaunches = []
def relaunch():
    relaunches.append(1)

# clean run
res, used = run_with_relaunch("FIX-1", lambda: "ok", relaunch, is_crash)
check("clean run: result + zero relaunches", res == "ok" and used == 0 and relaunches == [])

# crash once, then succeed — the same unit re-runs
attempts = []
def flaky():
    attempts.append(1)
    if len(attempts) == 1:
        raise TargetClosedError("Target page, context or browser has been closed")
    return "recovered"
res, used = run_with_relaunch("FIX-whiteboard-001", flaky, relaunch, is_crash, max_relaunches=1)
check("crash then success: same unit re-ran and recovered", res == "recovered" and len(attempts) == 2)
check("exactly one relaunch used", used == 1 and len(relaunches) == 1)

# crash on every attempt: CrashExhausted, unit + last error carried
def always_crash():
    raise TargetClosedError("Browser has been closed")
try:
    run_with_relaunch("FIX-whiteboard-003", always_crash, relaunch, is_crash, max_relaunches=1)
    check("double crash raises CrashExhausted", False)
except CrashExhausted as ce:
    check("double crash raises CrashExhausted", ce.unit == "FIX-whiteboard-003" and isinstance(ce.last_error, TargetClosedError) and ce.relaunches == 1)

# non-crash error: propagates untouched, no relaunch spent
before = len(relaunches)
def bug():
    raise ValueError("a real bug, not a crash")
try:
    run_with_relaunch("FIX-9", bug, relaunch, is_crash, max_relaunches=1)
    check("non-crash error propagates", False)
except ValueError:
    check("non-crash error propagates untouched", len(relaunches) == before)

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
