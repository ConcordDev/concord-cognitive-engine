#!/usr/bin/env python3
"""#2379 box-fix: offline pins for the three driver/expected bugs the real-Chromium run exposed.
  1. submit discovery: ticket verb 'submit' must find a lone 'Create' control (pick_submit), still None on 0 / 2+ / disabled.
  2. snapshot alerts: a role=alert region has no own name; its text is in the StaticText child (alert_texts).
  3. validation_block: a write in the create-click window AFTER the typed window is 'invalid input reached the API'.
Run: python3 selftest/test_ulw2379_fixes.py"""
import os, sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro, expected as X
from concord_walker.cdp import AXTree

FAILS, N = [], [0]
def check(n, c, x=""):
    N[0] += 1
    print(("PASS " if c else "FAIL ") + n + ("" if c else " :: " + str(x)))
    c or FAILS.append(n)

B = repro.pick_submit
check("verb 'submit' finds the lone enabled 'Create'", B([("Create", False), ("Cancel", False)], "submit") == "Create")
check("verb 'save' finds 'Save changes'", B([("Save changes", False), ("Cancel", False)], "save") == "Save changes")
check("exact verb still wins: 'create' -> 'Create'", B([("Create", False), ("Cancel", False)], "create") == "Create")
check("two create-like controls -> None (ambiguous) [failure path]", B([("Create", False), ("Save", False)], "submit") is None)
check("only a disabled Create -> None [failure path]", B([("Create", True), ("Cancel", False)], "submit") is None)
check("no create-like control -> None [failure path]", B([("Publish report", False), ("Cancel", False)], "submit") is None)
check("non-generic unknown verb does not widen: 'publish' -> None [failure path]", B([("Create", False)], "publish") is None)
check("duplicate same-named buttons count once", B([("Create", False), ("Create", False)], "submit") == "Create")

def node(i, role, name="", children=(), parent=None, ignored=False):
    return {"nodeId": str(i), "role": {"value": role}, "name": {"value": name}, "ignored": ignored, "childIds": [str(c) for c in children],
            "parentId": str(parent) if parent is not None else None, "properties": [], "backendDOMNodeId": i}
try:
    ax = AXTree([node(1, "RootWebArea", children=[2, 4]), node(2, "alert", "", children=[3], parent=1), node(3, "StaticText", "Amount must be greater than 0", parent=2),
                 node(4, "status", "Saved", parent=1)])
    got = repro.alert_texts(ax)
    check("alert with no own name yields its StaticText child", "Amount must be greater than 0" in got, got)
    check("named status region still reported", "Saved" in got, got)
    check("empty alert yields nothing [failure path]", repro.alert_texts(AXTree([node(1, "RootWebArea", children=[2]), node(2, "alert", "", parent=1)])) == [])
except Exception as e:
    check("AXTree fixture builds", False, repr(e))

def snap(wins, **kw):
    s = {"texts": [], "controls": [], "alerts": [], "evidence": {"step_windows": wins}}
    s.update(kw); return s
def state(snp):
    return X.check_expected("Inline error message", snp)["state"] if hasattr(X, "check_expected") else repro.check_expected("Inline error message", snp)["state"]
typed = {"n": 2, "action": "type_value", "writes": [], "typed": "-5"}
click_w = {"n": 3, "action": "click", "writes": ["POST /api/items"], "typed": None, "submit": False}
click_n = {"n": 3, "action": "click", "writes": [], "typed": None, "submit": False}
check("write in the create-click window after typing -> fail (never pass)", state(snap([typed, click_w])) == "fail", state(snap([typed, click_w])))
check("no write anywhere + inline alert -> pass", state(snap([typed, click_n], alerts=["Amount must be greater than 0"])) == "pass")
check("no write, no message/invalid/disabled -> unchecked [failure path]", state(snap([typed, click_n])) == "unchecked")
pre = {"n": 1, "action": "click", "writes": ["POST /api/boot"], "typed": None, "submit": False}
check("a write BEFORE any typed/submit step is not blamed on the input", state(snap([pre, typed, click_n], alerts=["Amount must be greater than 0"])) == "pass")
print("%d check(s), %d failure(s)" % (N[0], len(FAILS)))
sys.exit(1 if FAILS else 0)
